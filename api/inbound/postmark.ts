// api/inbound/postmark.ts
// keep the handler resilient while we iterate

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";

// IMPORTANT: ESM requires explicit extension for local imports
import parseHmPdf from "../../lib/pdf.js";
import { logParseResult } from "../../lib/parse-log.js";

// Use Node.js runtime (not edge)
export const config = { runtime: "nodejs" };

/* ------------------------------------------------------------------ */
/*  Env                                                               */
/* ------------------------------------------------------------------ */
const SUPABASE_URL  = process.env.SUPABASE_URL!;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RECEIPTS_BUCKET = process.env.RECEIPTS_BUCKET || "receipts";

// optional helpers for defaults
const DEFAULT_USER  = process.env.INBOUND_DEFAULT_USER_ID || "";
const ALLOW_UNVERIFIED = process.env.ALLOW_UNVERIFIED_INBOUND === "true";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

interface PostmarkAttachment {
  ContentType?: string;
  Content?: string;
  Name?: string;
}

interface PostmarkPayload {
  MailboxHash?: string;
  To?: string;
  Subject?: string;
  TextBody?: string;
  From?: string;
  FromFull?: { Email?: string };
  Attachments?: PostmarkAttachment[];
}

// Safe JSON body reader (Postmark posts JSON)
async function readJson(req: VercelRequest): Promise<PostmarkPayload> {
  const body = req.body;
  if (body) {
    if (typeof body === "string") {
      try { return JSON.parse(body) as PostmarkPayload; } catch { return {} as PostmarkPayload; }
    }
    if (typeof body === "object" && !Buffer.isBuffer(body)) return body as PostmarkPayload;
  }

  const raw = await new Promise<string>((resolve, reject) => {
    let s = "";
    req.on("data", c => (s += c));
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
  try { return JSON.parse(raw || "{}") as PostmarkPayload; } catch { return {} as PostmarkPayload; }
}

// Pull first email address from a header-ish string
function firstEmail(s?: string): string | undefined {
  if (!s) return undefined;
  const m = s.match(/<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i);
  return m?.[1];
}

// Extract UUID from plus-address (…+<uuid>@inbound.postmarkapp.com)
function extractUuidFromTo(to?: string): string | undefined {
  const email = firstEmail(to);
  const m = email?.match(/\+([0-9a-fA-F-]{36})@/);
  return m?.[1];
}

// Very light email text parse fallback (subject + text)
function naiveParse(subject: string, text: string): { merchant: string; order_id: string; total_cents: number | null } {
  // try very conservative extraction; the PDF is our main path
  const all = `${subject}\n${text}`.toLowerCase();
  const merchant =
    /best ?buy/.test(all) ? "bestbuy.com" :
    /target/.test(all)   ? "target.com"   :
    /walmart/.test(all)  ? "walmart.com"  :
    /hm\.?com|h&m/.test(all) ? "hm.com"   :
    "unknown";

  const mOrder = all.match(/order\s*#?\s*([a-z0-9\-]+)/i);
  const mTotal = all.match(/\$?\s*([0-9]+\.[0-9]{2})\s*(total|amount)/i);
  const total_cents = mTotal ? Math.round(parseFloat(mTotal[1]) * 100) : null;

  return { merchant, order_id: mOrder?.[1] ?? "", total_cents };
}

/* ------------------------------------------------------------------ */
/*  Handler                                                           */
/* ------------------------------------------------------------------ */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // minimal ping
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, info: "postmark inbound ready" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const payload = await readJson(req);

  // 1) Resolve user_id from MailboxHash or plus-address; else fallback
  let user_id: string | undefined = payload?.MailboxHash;
  if (!user_id) user_id = extractUuidFromTo(payload?.To);
  if (!user_id) user_id = DEFAULT_USER || undefined;

  if (!user_id) {
    // No user_id: in production we should reject; for now, allow if flagged
    if (!ALLOW_UNVERIFIED) {
      return res.status(200).json({ ok: true, ignored: true, reason: "missing user_id" });
    }
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // 2) Try to parse a PDF attachment first (that’s your H&M case)
  const atts: PostmarkAttachment[] = Array.isArray(payload?.Attachments) ? payload.Attachments : [];
  const pdfs = atts.filter(a => (a?.ContentType || "").toLowerCase().includes("pdf"));

  interface ParsedPdf {
    merchant?: string;
    order_number?: string;
    receipt_number?: string;
    order_date?: string;
    receipt_date?: string;
    total_cents?: number;
    tax_cents?: number;
    shipping_cents?: number;
  }

  let parsed: ParsedPdf | null = null;
  let storedPath: string | null = null;

  try {
    if (pdfs.length > 0) {
      // Postmark gives base64 in Attachment.Content, but some dev setups
      // (e.g. local Postmark webhooks) may supply a file path instead.
      const a0 = pdfs[0];
      const raw = a0.Content || "";
      let buf: Buffer;

      if (/^[A-Za-z0-9+/=\r\n]+$/.test(raw)) {
        // looks like base64
        buf = Buffer.from(raw, "base64");
      } else {
        try {
          // try reading as a file path
          buf = await fs.readFile(raw);
        } catch {
          buf = Buffer.from(raw, "base64");
        }
      }

      // parse the H&M PDF (or other text-extractable PDFs)
      parsed = (await parseHmPdf(buf)) as ParsedPdf;

      // store the original PDF in supabase storage for reference
      const folder = `${user_id || "unknown"}`;
      const fname  = `${Date.now()}-${(a0.Name || "receipt.pdf").replace(/[^\w.\-]+/g, "_")}`;
      const key = `${folder}/${fname}`;

      const up = await supabase.storage.from(RECEIPTS_BUCKET).upload(key, buf, {
        contentType: a0.ContentType || "application/pdf",
        upsert: false
      });
      if (!up.error) storedPath = key;
    }
  } catch (e) {
    // If PDF failed, fall back to naive from subject/body
    const message = e instanceof Error ? e.message : String(e);
    console.warn("[inbound] pdf parse failed:", message);
  }

  // 3) Build the record from parsed (pdf) or fallback (subject+text)
  const subject = payload?.Subject || "";
  const textBody = payload?.TextBody || "";
  const from     = payload?.FromFull?.Email || firstEmail(payload?.From) || "";
  const base     = naiveParse(subject, textBody);

  const merchant      = (parsed?.merchant || base.merchant || "unknown").toLowerCase();
  const order_id      = parsed?.order_number || base.order_id || "";
  const receipt_num   = parsed?.receipt_number || "";
  const purchase_date = parsed?.order_date || parsed?.receipt_date || null; // ISO or null
  const total_cents   = (parsed?.total_cents ?? base.total_cents) ?? null;
  const tax_cents     = parsed?.tax_cents ?? null;
  const shipping_cents= parsed?.shipping_cents ?? null;

  // Structured logging of parse outcome
  await logParseResult({
    parser: parsed ? "pdf" : "naive",
    merchant,
    order_id_found: !!order_id,
    purchase_date_found: !!purchase_date,
    total_cents_found: total_cents != null
  });

  // 4) Upsert the receipt
  try {
    const up = await supabase
      .from("receipts")
      .upsert(
        [{
          user_id,
          merchant,
          order_id,
          purchase_date,
          total_cents,
          tax_cents,
          shipping_cents,
          currency: "USD",
          raw_url: storedPath ? `supabase://${RECEIPTS_BUCKET}/${storedPath}` : null
        }],
        { onConflict: "user_id,merchant,order_id,purchase_date" }
      )
      .select("id")
      .single();

    if (up.error) throw up.error;

    // success
    return res.status(200).json({
      ok: true,
      receipt_id: up.data?.id || null,
      parsed_preview: parsed ? {
        merchant, order_id, purchase_date, total_cents, tax_cents, shipping_cents
      } : null
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[inbound] upsert error:", message);
    return res.status(500).json({ ok: false, error: message });
  }
}
