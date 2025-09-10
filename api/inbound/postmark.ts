// api/inbound/postmark.ts
// @ts-nocheck  // keep this while we iterate quickly

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import parseHmPdf from "../../lib/pdf.js";   // <<< IMPORTANT: .js extension

export const config = { runtime: "nodejs" };

// --- env
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RECEIPTS_BUCKET = process.env.RECEIPTS_BUCKET || "receipts";
const DEFAULT_USER    = process.env.INBOUND_DEFAULT_USER_ID || "";
const INBOUND_TOKEN   = process.env.POSTMARK_INBOUND_HOOK_TOKEN || ""; // optional signature we previously set
const ALLOW_UNVERIFIED = process.env.ALLOW_UNVERIFIED_INBOUND === "true";

// tiny helper to read raw JSON if body wasn't parsed
async function readJson(req: VercelRequest): Promise<any> {
  if (req.body && typeof req.body === "object") return req.body;
  const raw = await new Promise<string>((resolve, reject) => {
    let b = ""; req.on("data", c => (b += c)); req.on("end", () => resolve(b)); req.on("error", reject);
  });
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

// filter & map Postmark attachment shape -> Buffers
function getPdfBuffers(payload: any): Array<{ name: string; buf: Buffer; ctype: string }> {
  const atts: any[] = Array.isArray(payload?.Attachments) ? payload.Attachments : [];
  const pdfs = atts.filter(a => (a?.ContentType || "").toLowerCase().includes("pdf") && a?.Content);
  return pdfs.map(a => ({
    name: a.Name || "receipt.pdf",
    buf:  Buffer.from(String(a.Content), "base64"),
    ctype: a.ContentType || "application/pdf"
  }));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // optional signature check (leave permissive in test)
    if (!ALLOW_UNVERIFIED && INBOUND_TOKEN && req.headers["x-inbound-token"] !== INBOUND_TOKEN) {
      return res.status(401).json({ ok: false, error: "bad token" });
    }

    const payload = await readJson(req);
    const keys = Object.keys(payload || {});
    console.log("[inbound] keys:", keys);

    const pdfs = getPdfBuffers(payload);
    console.log("[inbound] attachments:", pdfs.map(p => `${p.name} (${p.ctype}) len=${p.buf.length}`));

    // If nothing to parse, acknowledge so Postmark doesn't keep retrying
    if (!pdfs.length) {
      return res.status(200).json({ ok: true, no_pdfs: true });
    }

    // Parse just the first PDF for now
    const first = pdfs[0];
    const preview = await parseHmPdf(first.buf);
    console.log("[inbound] preview:", preview);

    const userId = DEFAULT_USER || (payload?.MailboxHash ?? "").trim();
    if (!userId) {
      console.warn("[inbound] no user id; set INBOUND_DEFAULT_USER_ID or use +<uuid> mailbox");
    }

    // upsert receipt
    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // (optional) upload the PDF so we can view it later
    const objectKey = `${userId || "unknown"}/${Date.now()}-${first.name}`;
    const up = await sb.storage.from(RECEIPTS_BUCKET).upload(objectKey, first.buf, {
      contentType: first.ctype, upsert: true
    });
    if (up.error) console.warn("[inbound] storage upload error:", up.error);

    // Store a minimal receipt row
    const { data, error } = await sb
      .from("receipts")
      .upsert(
        [{
          user_id:       userId || null,
          merchant:      preview.merchant ?? "hm.com",
          order_id:      preview.order_number ?? "",
          purchase_date: preview.order_date ? preview.order_date.slice(0, 10) : null,
          total_cents:   preview.total_cents,
          tax_cents:     preview.tax_cents ?? null,
          shipping_cents: preview.shipping_cents ?? null,
          currency:      "USD",
          raw_url:       !up.error ? objectKey : null,  // we can resolve to a public URL later if needed
          channel:       "email"
        }],
        { onConflict: "user_id,merchant,order_id,purchase_date" }
      )
      .select("id")
      .single();

    if (error) throw error;

    return res.status(200).json({
      ok: true,
      receipt_id: data?.id ?? null,
      pages: preview.pages ?? null
    });
  } catch (e: any) {
    console.error("[inbound] error:", e?.stack || e);
    // Return 200 with a soft-ack to stop Postmark retries if you prefer:
    // return res.status(200).json({ ok: false, soft_fail: true });
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
