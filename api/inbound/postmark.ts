// api/inbound/postmark.ts
import type { VercelRequest, VercelResponse } from "vercel";
import { createClient } from "@supabase/supabase-js";
import * as crypto from "crypto";
import { parseHmPdf } from "../../lib/pdf";

export const config = { runtime: "nodejs18.x" };

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const INBOUND_TOKEN = process.env.POSTMARK_INBOUND_HOOK_TOKEN || "";
const RECEIPTS_BUCKET = process.env.RECEIPTS_BUCKET || "receipts";
const DEFAULT_USER = process.env.INBOUND_DEFAULT_USER_ID || "";

type PMAddress = { Email?: string; Name?: string; MailboxHash?: string };
type PMAttachment = { Name?: string; Content?: string; ContentType?: string; ContentLength?: number };
type PMInbound = {
  From?: string;
  FromFull?: PMAddress;
  To?: string;
  ToFull?: PMAddress[];
  Subject?: string;
  HtmlBody?: string;
  TextBody?: string;
  Attachments?: PMAttachment[];
};

function verifySignature(req: VercelRequest): boolean {
  if (!INBOUND_TOKEN) return false;
  const sig = (req.headers["x-postmark-signature"] as string) || "";
  if (!sig) return false;
  // HMAC-SHA256 of the raw JSON body using the Inbound Hook Token, base64 encoded
  const raw = Buffer.isBuffer((req as any).rawBody)
    ? (req as any).rawBody
    : Buffer.from(JSON.stringify(req.body || {}), "utf8");
  const hmac = crypto.createHmac("sha256", INBOUND_TOKEN).update(raw).digest("base64");
  // timingSafeEqual avoids timing leaks
  try { return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(sig)); } catch { return false; }
}

function extractUserId(toFull: PMAddress[] | undefined): string | null {
  for (const r of toFull || []) {
    const email = (r.Email || "").toLowerCase();
    // abc123+<uuid>@inbound.postmarkapp.com  -> capture uuid
    const m = email.match(/^[^+]+\+([0-9a-f-]{36})@/);
    if (m) return m[1];
    // Optional: MailboxHash (Postmark captures the +tag here too)
    if (r.MailboxHash && /^[0-9a-f-]{36}$/i.test(r.MailboxHash)) return r.MailboxHash;
  }
  return DEFAULT_USER || null;
}

async function uploadPdf(supabase: ReturnType<typeof createClient>, userId: string, receiptId: string, name: string, pdf: Buffer) {
  const safe = name?.replace(/[^a-z0-9._-]/gi, "_") || "receipt.pdf";
  const path = `${userId}/${receiptId}/${Date.now()}_${safe}`;
  const { error } = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, pdf, {
    contentType: "application/pdf",
    upsert: false
  });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
  return path;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  if (!verifySignature(req)) {
    return res.status(401).json({ ok: false, error: "signature verification failed" });
  }

  const payload = req.body as PMInbound;
  const userId = extractUserId(payload.ToFull);
  if (!userId) return res.status(400).json({ ok: false, error: "user id not resolved (missing +<uuid> tag and no default set)" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // Choose the first PDF attachment
  const att = (payload.Attachments || []).find(a =>
    (a.ContentType || "").toLowerCase().includes("pdf") ||
    (a.Name || "").toLowerCase().endsWith(".pdf")
  );

  if (!att?.Content) {
    return res.status(200).json({ ok: true, ignored: true, reason: "no-pdf-attachment" });
  }

  try {
    const pdfBuf = Buffer.from(att.Content, "base64");

    // Merchant hint from From domain / Subject
    const fromDomain = ((payload.From || "").split("@")[1] || "").toLowerCase();
    const merchant = fromDomain.includes("hm.") ? "hm.com" : fromDomain || "unknown";

    // Parse H&M PDFs (fallback: try anyway—harmless on non-H&M)
    const preview = await parseHmPdf(pdfBuf);

    // Insert receipt
    const { data: ins, error } = await supabase
      .from("receipts")
      .insert([{
        user_id: userId,
        merchant: preview.merchant || merchant,
        order_id: preview.order_number || preview.receipt_number || null,
        total_cents: preview.total_cents,
        purchase_date: preview.order_date || preview.receipt_date || new Date().toISOString()
      }])
      .select()
      .single();

    if (error || !ins?.id) throw new Error(error?.message || "insert failed");

    // Store the PDF
    let storage_path: string | null = null;
    try { storage_path = await uploadPdf(supabase, userId, ins.id, att.Name || "receipt.pdf", pdfBuf); }
    catch (e) { /* non-fatal for MVP */ }

    return res.status(200).json({
      ok: true,
      user_id: userId,
      receipt_id: ins.id,
      stored: !!storage_path,
      storage_path,
      parser: "hm",
      preview
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
