// api/inbound/postmark.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import parseHmPdf from "../../lib/pdf";                 // default export
import { computeReturnDeadline } from "../../lib/policies";

// ---- env ----
const SUPABASE_URL  = process.env.SUPABASE_URL!;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RECEIPTS_BUCKET = process.env.RECEIPTS_BUCKET || "receipts";
const DEFAULT_USER  = process.env.INBOUND_DEFAULT_USER_ID || "";
const ALLOW_UNVERIFIED = process.env.ALLOW_UNVERIFIED_INBOUND === "true";

// ---- helpers ----
function readJson(req: VercelRequest): any {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(String(req.body || "{}")); } catch { return {}; }
}
function isUuid(s?: string) {
  return !!s?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
}
function findPlusUuid(to?: string): string | undefined {
  const m = (to || "").match(/\+([0-9a-f\-]{36})@/i);
  return m?.[1];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true, info: "postmark webhook ready" });
  }

  const payload = readJson(req);

  // Resolve user id: MailboxHash first; else plus-address; else DEFAULT_USER
  let userId: string | undefined = payload?.MailboxHash;
  if (!isUuid(userId)) userId = findPlusUuid(payload?.To);
  if (!isUuid(userId)) userId = DEFAULT_USER || undefined;
  if (!isUuid(userId)) {
    return res.status(200).json({ ok: true, ignored: true, reason: "missing user id" });
  }

  // Find a PDF attachment and decode it to Buffer (Base64 -> Buffer)
  const att = (payload?.Attachments || []).find(
    (a: any) =>
      String(a?.ContentType || "").toLowerCase().includes("pdf") ||
      String(a?.Name || "").toLowerCase().endsWith(".pdf")
  );
  if (!att) {
    return res.status(200).json({ ok: true, ignored: true, reason: "no pdf attachment" });
  }

  let pdfBuf: Buffer;
  try {
    // Postmark provides Base64 string in `Content`
    const b64: string = att.Content;
    pdfBuf = Buffer.from(b64, "base64");
    if (!pdfBuf.length) throw new Error("empty attachment buffer");
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: `bad attachment content: ${e?.message || e}` });
  }

  // Parse the H&M PDF
  let parsed: any;
  try {
    parsed = await parseHmPdf(pdfBuf);
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: `pdf-parse failed: ${e?.message || e}` });
  }

  const merchant      = (parsed.merchant ?? "").toLowerCase() || "unknown";
  const orderId       = parsed.order_number || parsed.receipt_number || "";
  const purchaseDate  = parsed.order_date ?? parsed.receipt_date ?? null;
  const totalCents    = parsed.total_cents ?? null;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Upsert receipt (dedup key: user_id, merchant, order_id, purchase_date)
  const { data: r, error: upErr } = await sb
    .from("receipts")
    .upsert(
      [{
        user_id: userId,
        merchant,
        order_id: orderId || "",
        purchase_date: purchaseDate,
        total_cents: totalCents,
        channel: "email",
        raw_url: null
      }],
      { onConflict: "user_id,merchant,order_id,purchase_date" }
    )
    .select("id")
    .single();

  if (upErr) return res.status(500).json({ ok: false, error: upErr.message });
  const receiptId: string = r?.id;

  // Upload the original PDF to Storage (non-fatal if it fails)
  try {
    const name = (att?.Name || `${receiptId}.pdf`).replace(/\s+/g, "_");
    await sb.storage.from(RECEIPTS_BUCKET)
      .upload(`${userId}/${name}`, pdfBuf, { contentType: "application/pdf", upsert: true });
  } catch (e: any) {
    console.warn("[inbound] storage upload failed:", e?.message || e);
  }

  // Create/refresh the return deadline if we can compute one
  try {
    const due = purchaseDate ? computeReturnDeadline(merchant, purchaseDate) : null;
    if (due) {
      await sb.from("deadlines").upsert(
        [{
          receipt_id: receiptId,
          type: "return",
          status: "open",
          due_at: due.toISOString()
        }],
        { onConflict: "receipt_id,type" }
      );
    }
  } catch (e: any) {
    console.warn("[inbound] deadline upsert failed:", e?.message || e);
  }

  return res.status(200).json({ ok: true, receipt_id: receiptId, parsed });
}
