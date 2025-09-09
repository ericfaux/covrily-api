// @ts-nocheck
// api/inbound/postmark.ts

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import * as crypto from "crypto";

// IMPORTANT: default import + .js extension for ESM + NodeNext
import parseHmPdf from "../../lib/pdf.js";

export const config = { runtime: "nodejs" };

// ---- env ----
const SUPABASE_URL     = process.env.SUPABASE_URL!;
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const INBOUND_TOKEN    = process.env.POSTMARK_INBOUND_HOOK_TOKEN || "";
const RECEIPTS_BUCKET  = process.env.RECEIPTS_BUCKET || "receipts";
const DEFAULT_USER     = process.env.INBOUND_DEFAULT_USER_ID || "";
const ALLOW_UNVERIFIED = process.env.ALLOW_UNVERIFIED_INBOUND === "true";

// ---- Postmark types ----
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

// ---- helpers ----
function safePayload(req: VercelRequest): any {
  // Postmark sends application/json. Some runtimes pass body as string.
  const b = (req as any).body;
  if (!b) return {};
  if (typeof b === "string") {
    try { return JSON.parse(b); } catch { return {}; }
  }
  return b;
}

function verifySignature(req: VercelRequest): boolean | "skipped" {
  const sig = (req.headers["x-postmark-signature"] as string) || "";
  if (!INBOUND_TOKEN || !sig) return "skipped";
  try {
    const raw = Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body || {}), "utf8");
    const hmac = crypto.createHmac("sha256", INBOUND_TOKEN).update(raw).digest("base64");
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(sig));
  } catch {
    return false;
  }
}

function resolveUserId(toFull: PMAddress[] | undefined): string | null {
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

// ---- handler ----
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // basic diagnostics always visible in Vercel logs
  console.log("[inbound] hit", {
    ct: req.headers["content-type"],
    hasBody: !!req.body,
  });

  // signature check (allow bypass if configured)
  const sig = verifySignature(req);
  if (sig !== true && !ALLOW_UNVERIFIED) {
    console.warn("[inbound] signature failed; blocking");
    return res.status(401).json({ ok: false, error: "signature verification failed or missing" });
  }

  const payload: PMInbound = safePayload(req);
  console.log("[inbound] keys", Object.keys(payload || {}));

  const userId = resolveUserId(payload.ToFull);
  if (!userId) {
    console.warn("[inbound] no user id resolved");
    return res.status(200).json({ ok: true, ignored: true, reason: "no-user-id" });
  }

  const atts = (payload.Attachments || []) as PMAttachment[];
  console.log("[inbound] attachments", atts.length, atts.map(a => ({ n: a.Name, ct: a.ContentType, len: a.ContentLength })));

  const att = atts.find(a =>
    (a.ContentType || "").toLowerCase().includes("pdf") ||
    (a.Name || "").toLowerCase().endsWith(".pdf")
  );
  if (!att?.Content) {
    console.log("[inbound] no pdf attachment");
    return res.status(200).json({ ok: true, ignored: true, reason: "no-pdf-attachment" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const pdfBuf = Buffer.from(att.Content, "base64");

    const fromDomain = ((payload.From || "").split("@")[1] || "").toLowerCase();
    const merchant = fromDomain.includes("hm.") ? "hm.com" : fromDomain || "unknown";

    const preview = await parseHmPdf(pdfBuf);
    console.log("[inbound] parsed preview", {
      merchant: preview.merchant,
      total: preview.total_cents,
      order: preview.order_number,
    });

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
    try { storage_path = await uploadPdf(supabase, userId, ins.id, att.Name || "receipt.pdf", pdfBuf); } catch (e: any) {
      console.warn("[inbound] storage upload warn", e?.message || e);
    }

    console.log("[inbound] done", { receipt_id: ins.id, stored: !!storage_path });
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
    console.error("[inbound] error", e?.stack || e?.message || e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
