// api/inbound/postmark.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import * as crypto from "crypto";
import { parseHmPdf } from "../../lib/pdf";

export const config = { runtime: "nodejs" }; // <— was "nodejs18.x", which Vercel rejects

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const INBOUND_TOKEN = process.env.POSTMARK_INBOUND_HOOK_TOKEN || ""; // optional in test
const RECEIPTS_BUCKET = process.env.RECEIPTS_BUCKET || "receipts";
const DEFAULT_USER = process.env.INBOUND_DEFAULT_USER_ID || "";
const ALLOW_UNVERIFIED = process.env.ALLOW_UNVERIFIED_INBOUND === "true";

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

function verifySignature(req: VercelRequest): boolean | "skipped" {
  const sig = (req.headers["x-postmark-signature"] as string) || "";
  if (!INBOUND_TOKEN || !sig) return "skipped";
  const raw = Buffer.isBuffer((req as any).rawBody)
    ? (req as any).rawBody
    : Buffer.from(JSON.stringify(req.body || {}), "utf8");
  const hmac = crypto.createHmac("sha256", INBOUND_TOKEN).update(raw).digest("base64");
  try { return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(sig)); } catch { return false; }
}

function extractUserId(toFull: PMAddress[] | undefined): string | null {
  for (const r of toFull || []) {
    const email = (r.Email || "").toLowerCase();
    const m = email.match(/^[^+]+\+([0-9a-f-]{36})@/);
    if (m) return m[1];
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

  const sig = verifySignature(req);
  if (sig !== true) {
    if (sig === "skipped" && ALLOW_UNVERIFIED) {
      // accept unsigned in test/dev
    } else {
      return res.status(401).json({ ok: false, error: "signature verification failed or missing" });
    }
  }

  const payload = req.body as PMInbound;
  const userId = extractUserId(payload.ToFull);
  if (!userId) return res.status(400).json({ ok: false, error: "user id not resolved (missing +<uuid> tag and no default set)" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const att = (payload.Attachments || []).find(a =>
    (a.ContentType || "").toLowerCase().includes("pdf") ||
    (a.Name || "").toLowerCase().endsWith(".pdf")
  );
  if (!att?.Content) return res.status(200).json({ ok: true, ignored: true, reason: "no-pdf-attachment" });

  try {
    const pdfBuf = Buffer.from(att.Content, "base64");
    const fromDomain = ((payload.From || "").split("@")[1] || "").toLowerCase();
    const merchant = fromDomain.includes("hm.") ? "hm.com" : fromDomain || "unknown";

    const preview = await parseHmPdf(pdfBuf);

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

    let storage_path: string | null = null;
    try { storage_path = await uploadPdf(supabase, userId, ins.id, att.Name || "receipt.pdf", pdfBuf); } catch {}

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
