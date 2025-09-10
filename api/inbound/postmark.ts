// /api/inbound/postmark.ts
// Minimal, production-safe inbound handler for Postmark with PDF attachments.
//
// Key fix: always pass a Buffer to the PDF parser (never a string path).
//          import the local ESM module with `.js` (NodeNext).

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import parseHmPdf from "../../lib/pdf.js"; // <-- NOTE the .js extension

export const config = { runtime: "nodejs" };

// ---- env ----
const SUPABASE_URL   = process.env.SUPABASE_URL!;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RECEIPTS_BUCKET = process.env.RECEIPTS_BUCKET || "receipts";
const DEFAULT_USER    = process.env.INBOUND_DEFAULT_USER_ID || "";
const ALLOW_UNVERIFIED = process.env.ALLOW_UNVERIFIED_INBOUND === "true";

// ---- types (subset of Postmark’s payload) ----
type PMAddress = { Email?: string; Name?: string; MailboxHash?: string };
type PMAttachment = {
  Name?: string;
  Content?: string;        // Base64
  ContentType?: string;    // "application/pdf"
  ContentLength?: number;
};
type PMInbound = {
  From?: string;
  FromFull?: PMAddress;
  To?: string;
  MailboxHash?: string;    // the part after + in the inbound address
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  Attachments?: PMAttachment[];
};

// ---- helpers ----
function sanitizeUuid(s?: string): string | undefined {
  if (!s) return undefined;
  const trimmed = s.trim().replace(/^['"<\s]+|['">\s]+$/g, "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : undefined;
}

function firstNonEmpty(...vals: (string | null | undefined)[]) {
  for (const v of vals) {
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return undefined;
}

// read JSON body safely (Vercel may already give object in req.body)
async function readJson(req: VercelRequest): Promise<any> {
  if (req.body && typeof req.body === "object") return req.body;
  const raw = await new Promise<string>((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => resolve(buf));
    req.on("error", reject);
  });
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

function toCents(n?: number | string | null): number | null {
  if (n == null || n === "") return null;
  const v = typeof n === "number" ? n : parseFloat(String(n).replace(/[^\d.]/g, ""));
  return Number.isFinite(v) ? Math.round(v * 100) : null;
}

function isoDateOrNull(s?: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ---- handler ----
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Simple “is alive” for Postmark setup page
  if (req.method === "GET" || req.method === "HEAD") {
    return res.status(200).json({ ok: true, route: "inbound/postmark" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // Optional: if you later wire Postmark signature verification, guard here.
  if (!ALLOW_UNVERIFIED) {
    // Left intentionally open (already gated by Postmark sending to this URL).
    // Add HMAC verification here if/when you enable it.
  }

  // Parse payload
  const payload: PMInbound = await readJson(req);
  const attachments = Array.isArray(payload.Attachments) ? payload.Attachments : [];
  const pdfs = attachments.filter(a =>
    (a.ContentType || "").toLowerCase().includes("pdf") ||
    (a.Name || "").toLowerCase().endsWith(".pdf")
  );

  if (pdfs.length === 0) {
    // Nothing to do; acknowledge so Postmark shows “Processed”
    return res.status(200).json({ ok: true, processed: 0, reason: "no-pdf-attachments" });
  }

  // user_id from MailboxHash (the +<uuid> part) or fallback
  const userId =
    sanitizeUuid(payload.MailboxHash) ||
    sanitizeUuid(payload.FromFull?.MailboxHash) ||
    sanitizeUuid(DEFAULT_USER);

  if (!userId) {
    return res.status(200).json({ ok: true, ignored: true, reason: "missing user uuid" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const results: any[] = [];

  for (const att of pdfs) {
    try {
      // *** THE FIX: decode Base64 → Buffer ***
      const b64 = att.Content || "";
      if (!b64) {
        results.push({ name: att.Name || "unnamed.pdf", ok: false, error: "empty attachment content" });
        continue;
      }
      const buf = Buffer.from(b64, "base64");

      // Parse the PDF buffer (never pass a string)
      const preview = await parseHmPdf(buf);

      const merchant = firstNonEmpty(preview.merchant, (payload.FromFull?.Email || "").split("@")[1], "unknown")!.toLowerCase();
      const orderId  = firstNonEmpty(preview.order_number, "") || "";
      const purchase = isoDateOrNull(preview.order_date || preview.receipt_date);
      const totalCents = preview.total_cents != null ? preview.total_cents : toCents(null);
      const taxCents   = preview.tax_cents   != null ? preview.tax_cents   : null;
      const shipCents  = preview.shipping_cents != null ? preview.shipping_cents : null;

      // Upsert receipt
      const { data: receipt, error: rErr } = await supabase
        .from("receipts")
        .upsert(
          [{
            user_id: userId,
            merchant,
            order_id: orderId,               // keep '' not null for unique key
            purchase_date: purchase,         // YYYY-MM-DD or null
            total_cents: totalCents,
            tax_cents: taxCents,
            shipping_cents: shipCents,
            currency: "USD"
          }],
          { onConflict: "user_id,merchant,order_id,purchase_date" }
        )
        .select("id")
        .single();

      if (rErr) throw rErr;
      const receiptId = receipt?.id as string | undefined;

      // Store original PDF in Supabase Storage (optional but useful)
      if (receiptId) {
        const path = `${userId}/${receiptId}.pdf`;
        const { error: upErr } = await supabase
          .storage
          .from(RECEIPTS_BUCKET)
          .upload(path, buf, {
            contentType: att.ContentType || "application/pdf",
            upsert: true
          });
        if (upErr) {
          // Don’t fail the webhook for a storage hiccup; just log in the result
          results.push({ name: att.Name, ok: true, receipt_id: receiptId, stored: false, store_error: upErr.message });
          continue;
        }
      }

      results.push({ name: att.Name, ok: true, receipt_id: receiptId, parsed: preview.ok === true });
    } catch (e: any) {
      results.push({ name: att.Name, ok: false, error: String(e?.message || e) });
    }
  }

  return res.status(200).json({ ok: true, processed: results.length, results });
}
