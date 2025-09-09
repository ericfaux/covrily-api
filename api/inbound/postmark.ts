// @ts-nocheck
// api/inbound/postmark.ts

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

// IMPORTANT for ESM + NodeNext: keep the .js extension here
import parseHmPdf from "../../lib/pdf.js";

// If you later want deadlines, you can import your rule engine:
// import { computeReturnDeadline } from "../../lib/policies.js";

// Ensure this runs on the Node.js runtime (not Edge)
export const config = { runtime: "nodejs" } as const;

// ---- env ----
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET       = process.env.RECEIPTS_BUCKET || "receipts";
const DEFAULT_USER = process.env.INBOUND_DEFAULT_USER_ID || "";
const ALLOW_ANY    = (process.env.ALLOW_UNVERIFIED_INBOUND || "true").toLowerCase() === "true";

// ---- Postmark payload types (subset) ----
type PMAddress = { Email?: string; Name?: string; MailboxHash?: string };

type PMAttachment = {
  Name?: string;
  Content?: string;       // base64
  ContentType?: string;   // e.g. application/pdf
  ContentLength?: number;
};

type PMInbound = {
  From?: string;
  FromFull?: PMAddress;
  To?: string;
  ToFull?: PMAddress | PMAddress[];
  Subject?: string;
  HtmlBody?: string;
  TextBody?: string;
  MailboxHash?: string;
  Attachments?: PMAttachment[];
  Headers?: Array<{ Name?: string; Value?: string }>;
};

// ---- helpers ----
function isUuid(s?: string): boolean {
  return !!s?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
}

function headerValue(p: PMInbound, name: string): string | undefined {
  return p.Headers?.find(h => h?.Name?.toLowerCase() === name.toLowerCase())?.Value;
}

async function readJson(req: VercelRequest): Promise<any> {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

function deriveUserId(p: PMInbound): string {
  // 1) MailboxHash if Postmark supplied it
  let id = (p.MailboxHash || "").trim();

  // 2) Or receipts+<uuid>@… plus-addressing in To
  if (!isUuid(id)) {
    const toHeader = p.To || headerValue(p, "To") || "";
    const toEmail  = toHeader.match(/<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i)?.[1] || "";
    const m        = toEmail.match(/\+([0-9a-f-]{36})@/i);
    id = (m?.[1] || "").trim();
  }

  // 3) Last resort: DEFAULT_USER (useful during testing)
  if (!isUuid(id) && isUuid(DEFAULT_USER)) id = DEFAULT_USER;
  return id;
}

function decodeAttachmentBase64(a: PMAttachment): Buffer | null {
  const b64 = (a.Content || "").trim();
  if (!b64) return null;
  try { return Buffer.from(b64, "base64"); } catch { return null; }
}

function safeFileName(name?: string): string {
  return (name || "file.dat").replace(/[^\w.\-]/g, "_").slice(0, 120);
}

// ---- handler ----
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Health check / quick ping
  if (req.method === "GET" || req.method === "HEAD") {
    return res.status(200).json({ ok: true, info: "inbound webhook ready" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const payload: PMInbound = await readJson(req);
  console.log("[inbound] hit { ct:", req.headers["content-type"], ", hasBody:", !!payload, "}");
  if (!payload) return res.status(400).json({ ok: false, error: "no payload" });

  // (optional) signature verification could go here if you enable it later
  if (!ALLOW_ANY) {
    // verify signature…
  }

  // Resolve user
  const userId = deriveUserId(payload);
  if (!isUuid(userId)) {
    console.warn("[inbound] ignored — missing/invalid user id; set MailboxHash or +<uuid>@ in To");
    return res.status(200).json({ ok: true, ignored: true, reason: "no user id" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  // Handle attachments (we only care about PDFs here)
  const atts = payload.Attachments || [];
  console.log("[inbound] attachments count:", atts.length);

  let ingested = 0;

  for (const a of atts) {
    const ct  = (a.ContentType || "").toLowerCase();
    const len = a.ContentLength || (a.Content ? a.Content.length : 0);
    console.log("[inbound] att:", a.Name, ct, len);

    if (!ct.includes("pdf")) continue;

    // Always parse from a Buffer (never from a fs path)
    const buf = decodeAttachmentBase64(a);
    if (!buf?.length) {
      console.warn("[inbound] skip attachment — empty/undecodable base64:", a.Name);
      continue;
    }

    try {
      // 1) Parse the PDF to get structured fields
      const preview = await parseHmPdf(buf);

      const merchant      = (preview.merchant || (payload.FromFull?.Email?.split("@")[1] ?? "") || "unknown").toLowerCase();
      const orderId       = preview.order_number || "";
      const receiptNo     = preview.receipt_number || "";
      const purchaseISO   = preview.order_date || preview.receipt_date || null;
      const totalCents    = preview.total_cents ?? null;

      // NEW FIELDS (optional if parser provided them)
      const taxCents      = (preview as any).tax_cents ?? null;
      const shippingCents = (preview as any).shipping_cents ?? null;
      const currency      = (preview as any).currency || "USD";

      // 2) Persist the raw PDF (non-fatal if this fails)
      const objectKey = `${userId}/${Date.now()}-${safeFileName(a.Name)}`;
      try {
        await supabase.storage.from(BUCKET).upload(objectKey, buf, {
          contentType: ct || "application/pdf",
          upsert: false,
        });
      } catch (e) {
        console.warn("[inbound] storage upload warn:", (e as any)?.message || e);
      }

      // 3) Upsert the receipt — includes the new tax/shipping/currency fields
      const { data: r0, error: rErr } = await supabase
        .from("receipts")
        .upsert(
          [{
            user_id:       userId,
            merchant,
            order_id:      orderId || receiptNo, // prefer order, fall back to receipt number
            purchase_date: purchaseISO,          // may be null
            total_cents:   totalCents,

            // NEW columns:
            tax_cents:      taxCents,
            shipping_cents: shippingCents,
            currency,
          }],
          { onConflict: "user_id,merchant,order_id,purchase_date" }
        )
        .select("id")
        .single();

      if (rErr) throw rErr;
      const receiptId: string | undefined = r0?.id;
      ingested++;

      console.log("[inbound] upserted receipt:", receiptId, merchant, orderId, totalCents, {
        tax_cents: taxCents, shipping_cents: shippingCents, currency,
      });

      // 4) (optional) deadlines
      // if (purchaseISO && receiptId) {
      //   const due = computeReturnDeadline(merchant, purchaseISO);
      //   if (due) {
      //     await supabase.from("deadlines").upsert(
      //       [{ receipt_id: receiptId, type: "return", status: "open", due_at: due.toISOString() }],
      //       { onConflict: "receipt_id,type" }
      //     );
      //   }
      // }
    } catch (e: any) {
      console.error("[inbound] attachment parse/upsert error:", e?.message || e);
      // keep going to the next attachment
    }
  }

  // If there were no PDFs, you could add a fallback text/HTML parser here.

  return res.status(200).json({ ok: true, user_id: userId, attachments: atts.length, ingested });
}
