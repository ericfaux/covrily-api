// api/inbound/postmark.ts
// Robust Postmark inbound webhook that safely handles PDFs and never triggers
// pdf-parse’s local test file fallback.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

// IMPORTANT: default import; we’ll only call it with a real Buffer
import parseHmPdf from "../../lib/pdf";

export const config = { runtime: "nodejs" }; // <- correct for Vercel Node runtimes

// --- env
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RECEIPTS_BUCKET = process.env.RECEIPTS_BUCKET || "receipts";

// Optional soft “auth” during testing. When set, we require ?token=… to match.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

// If you use Postmark’s inbound webhook signature, you can verify it here.
// For now we’ll gate with ADMIN_TOKEN only to simplify.

function ok(res: VercelResponse, body: any = { ok: true }) {
  return res.status(200).json(body);
}
function bad(res: VercelResponse, msg: string, code = 400) {
  return res.status(code).json({ ok: false, error: msg });
}

function isPdfAttachment(att: any): boolean {
  const ct = (att?.ContentType || att?.ContentTypeFull || "").toLowerCase();
  const name = (att?.Name || "").toLowerCase();
  return ct.includes("application/pdf") || name.endsWith(".pdf");
}

function looksLikePdf(buf: Buffer): boolean {
  // %PDF header bytes
  return buf && buf.length >= 4 &&
         buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 0) quick “auth” for manual tests (optional)
  const token = (req.query.token as string) || "";
  if (ADMIN_TOKEN && token !== ADMIN_TOKEN) {
    return bad(res, "not found", 404);
  }

  // 1) Only POST from Postmark; GET can be used as a ping
  if (req.method === "GET" || req.method === "HEAD") {
    return ok(res, { ok: true, info: "postmark webhook ok" });
  }
  if (req.method !== "POST") {
    return bad(res, "method not allowed", 405);
  }

  const payload = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const attachments = Array.isArray(payload?.Attachments) ? payload.Attachments : [];

  // Postmark puts the “+<uuid>” in MailboxHash if you use address+<uuid>@inbound.postmarkapp.com
  const mailboxHash: string = (payload?.MailboxHash || "").trim();
  const userId = mailboxHash || process.env.INBOUND_DEFAULT_USER_ID || "";

  if (!userId) {
    console.warn("[inbound] no user id (MailboxHash or default) → ack & skip.");
    return ok(res, { ok: true, ignored: true, reason: "no user id" });
  }

  // 2) Find the first PDF attachment; if none, ack & skip (don’t 500)
  const pdfAtt = attachments.find(isPdfAttachment);
  if (!pdfAtt) {
    console.warn("[inbound] no PDF attachment → ack & skip.");
    return ok(res, { ok: true, ignored: true, reason: "no pdf attachment" });
  }

  // 3) Decode base64 safely; ensure it looks like a PDF
  let pdfBuf: Buffer | null = null;
  try {
    const b64 = String(pdfAtt.Content || "");
    if (!b64) {
      console.warn("[inbound] pdf attachment had no Content; ack & skip.");
      return ok(res, { ok: true, ignored: true, reason: "empty pdf content" });
    }
    pdfBuf = Buffer.from(b64, "base64");
  } catch (e) {
    console.warn("[inbound] base64 decode failed → ack & skip.", e);
    return ok(res, { ok: true, ignored: true, reason: "invalid base64" });
  }

  if (!pdfBuf?.length || !looksLikePdf(pdfBuf)) {
    console.warn("[inbound] not a real PDF (magic header missing) → ack & skip.");
    return ok(res, { ok: true, ignored: true, reason: "not a pdf" });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // 4) Persist the raw PDF to storage (handy for audits). Name: <ts>-<filename or random>.pdf
  const ts = Math.floor(Date.now() / 1000);
  const safeName = (pdfAtt.Name || `receipt-${ts}.pdf`).replace(/[^\w.\-]+/g, "_");
  const objectPath = `${userId}/${ts}-${safeName}`;
  {
    const { error } = await supabase.storage.from(RECEIPTS_BUCKET).upload(objectPath, pdfBuf, {
      contentType: "application/pdf",
      upsert: false
    });
    if (error) console.warn("[inbound] storage upload warning:", error.message);
  }

  // 5) Parse the PDF into structured fields (defensive try/catch)
  let parsed: Awaited<ReturnType<typeof parseHmPdf>> | null = null;
  try {
    parsed = await parseHmPdf(pdfBuf);
  } catch (e: any) {
    console.warn("[inbound] pdf parse failed; we will still ack. msg=", e?.message || e);
    // We *could* fall back to a generic receipt row with unknowns; for now we just ack.
    return ok(res, { ok: true, stored: objectPath, ignored: true, reason: "parse failed" });
  }

  // 6) Upsert into receipts (conservative on required fields)
  const merchant = parsed?.merchant || "unknown";
  const orderId  = parsed?.order_number || "";
  const receiptDateISO = parsed?.receipt_date || parsed?.order_date || null;
  const totalCents = parsed?.total_cents ?? null;

  try {
    const { data, error } = await supabase
      .from("receipts")
      .upsert(
        [{
          user_id: userId,
          merchant,
          order_id: orderId,
          purchase_date: receiptDateISO,
          total_cents: totalCents,
          raw_url: null
        }],
        { onConflict: "user_id,merchant,order_id,purchase_date" }
      )
      .select("id")
      .single();

    if (error) {
      console.error("[inbound] receipts.upsert error:", error.message);
      return ok(res, { ok: true, stored: objectPath, ignored: true, reason: "db upsert error" });
    }

    // (Optional) If you compute deadlines right here, call your policy engine.
    // For now we just return success.
    return ok(res, { ok: true, stored: objectPath, receipt_id: data?.id ?? null, merchant, orderId });
  } catch (e: any) {
    console.error("[inbound] receipts.upsert exception:", e?.message || e);
    return ok(res, { ok: true, stored: objectPath, ignored: true, reason: "db exception" });
  }
}
