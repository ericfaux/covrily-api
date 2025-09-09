// api/inbound/postmark.ts
// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import * as crypto from "crypto";

// IMPORTANT for ESM + NodeNext: include `.js` in relative imports
import parseHmPdf from "../../lib/pdf.js";

export const config = { runtime: "nodejs" };

const SUPABASE_URL  = process.env.SUPABASE_URL!;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const INBOUND_TOKEN = process.env.POSTMARK_INBOUND_HOOK_TOKEN || ""; // optional for now
const DEFAULT_USER  = process.env.INBOUND_DEFAULT_USER_ID || "";
const RECEIPTS_BUCKET = process.env.RECEIPTS_BUCKET || "receipts";

function readJson(req: VercelRequest): Promise<any> {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try { resolve(JSON.parse(buf || "{}")); } catch { resolve({}); }
    });
    req.on("error", reject);
  });
}

function header(payload: any, name: string): string | undefined {
  const arr: Array<{ Name?: string; Value?: string }> | undefined = payload?.Headers;
  return arr?.find(h => h?.Name?.toLowerCase() === name.toLowerCase())?.Value;
}

function firstEmail(v?: string): string | undefined {
  if (!v) return undefined;
  const m = v.match(/<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i);
  return m?.[1];
}

function sanitizeUuid(s?: string): string | undefined {
  if (!s) return undefined;
  return s.trim().replace(/^['"<\s]+|['">\s]+$/g, "");
}
function isUuid(s?: string): boolean {
  return !!s?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET" || req.method === "HEAD") {
    return res.status(200).json({ ok: true, info: "Postmark inbound ready" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const payload = await readJson(req);
  console.log("[inbound] keys:", Object.keys(payload || {}));

  // resolve user_id from MailboxHash or plus‑address
  let userId = sanitizeUuid(payload?.MailboxHash);
  if (!userId) {
    const toEmail = firstEmail(payload?.To || header(payload, "To"));
    const m = toEmail?.match(/\+([^@]+)@/);
    userId = sanitizeUuid(m?.[1]);
  }
  if (!isUuid(userId)) userId = DEFAULT_USER;
  if (!isUuid(userId)) {
    console.warn("[inbound] ignored — missing valid user id (MailboxHash/plus‑address)");
    return res.status(200).json({ ok: true, ignored: true, reason: "missing user id" });
  }

  // Grab first PDF attachment if present
  const atts: any[] = Array.isArray(payload?.Attachments) ? payload.Attachments : [];
  const pdf = atts.find(a =>
    /application\/pdf|\.pdf$/i.test(a?.ContentType || "") ||
    /\.pdf$/i.test(a?.Name || "")
  );

  let parsedPdf: any = null;
  if (pdf?.Content && pdf?.ContentLength) {
    try {
      // Postmark sends Base64; always parse from Buffer – never a file path
      const buf = Buffer.from(pdf.Content, "base64");
      parsedPdf = await parseHmPdf(buf);
      console.log("[inbound] pdf parsed:", {
        merchant: parsedPdf?.merchant,
        total_cents: parsedPdf?.total_cents
      });
    } catch (e) {
      console.error("[inbound] pdf parse error:", e);
    }
  }

  // Build receipt fields from subject/text or pdf
  const subject: string = payload?.Subject || header(payload, "Subject") || "";
  const textBody: string = payload?.TextBody || "";
  const combinedText = `${subject}\n\n${textBody}`.toLowerCase();

  // merchant inference (prefer parsed PDF)
  const merchant =
    parsedPdf?.merchant ||
    (combinedText.includes("hm.com") || combinedText.includes("h&m") ? "hm.com" : "unknown");

  const orderId = parsedPdf?.order_number || "";
  const purchaseDate = (parsedPdf?.order_date || parsedPdf?.receipt_date || "").slice(0, 10) || null;
  const totalCents = parsedPdf?.total_cents ?? null;
  const taxCents   = parsedPdf?.tax_cents ?? null;
  const shipCents  = parsedPdf?.shipping_cents ?? null;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // 1) upsert receipt
  const { data: rec, error: rErr } = await supabase
    .from("receipts")
    .upsert(
      [{
        user_id: userId,
        merchant,
        order_id: orderId || "",
        purchase_date: purchaseDate,         // may be null
        total_cents: totalCents,             // may be null
        tax_cents: taxCents,
        shipping_cents: shipCents,
        currency: "USD",                     // default; adjust per parsing later
        channel: "email"
      }],
      { onConflict: "user_id,merchant,order_id,purchase_date" }
    )
    .select("id")
    .single();

  if (rErr) {
    console.error("[inbound] receipts.upsert error:", rErr);
    return res.status(500).json({ ok: false, error: rErr.message });
  }
  const receiptId = rec?.id as string;

  // 2) store PDF in storage (optional but nice to have)
  if (pdf?.Content && receiptId) {
    try {
      const buf = Buffer.from(pdf.Content, "base64");
      const objectPath = `${userId}/${Date.now()}-${pdf.Name || "receipt"}.pdf`;
      const { error: upErr } = await supabase.storage.from(RECEIPTS_BUCKET)
        .upload(objectPath, buf, { contentType: "application/pdf", upsert: false });
      if (upErr) console.warn("[inbound] storage upload warn:", upErr.message);
      else await supabase.from("receipts").update({ raw_url: objectPath }).eq("id", receiptId);
    } catch (e: any) {
      console.warn("[inbound] storage upload error:", e?.message || e);
    }
  }

  // 3) if we ever pass a product page, persist link (kept compatible with your earlier schema)
  const url = ""; // we don’t auto‑discover product URLs from PDFs yet
  if (url && receiptId) {
    const { error: lErr } = await supabase.from("product_links").upsert([{
      receipt_id: receiptId,
      url,
      merchant_hint: merchant,
      active: true
    }], { onConflict: "receipt_id,url" });
    if (lErr) console.warn("[inbound] product_links upsert warn:", lErr.message);
  }

  return res.status(200).json({
    ok: true,
    receipt_id: receiptId,
    parsed: !!parsedPdf,
    totals: { purchase_cents: totalCents, tax_cents: taxCents, shipping_cents: shipCents }
  });
}
