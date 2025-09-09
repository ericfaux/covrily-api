// /api/inbound/postmark.ts
// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import * as crypto from "crypto";
import parseHmPdf from "../../lib/pdf.js";

export const config = { runtime: "nodejs" };

/* ---------- env ---------- */
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const INBOUND_TOKEN = process.env.POSTMARK_INBOUND_HOOK_TOKEN || ""; // optional while testing
const RECEIPTS_BUCKET = process.env.RECEIPTS_BUCKET || "receipts";
const DEFAULT_USER = process.env.INBOUND_DEFAULT_USER_ID || "";
const ALLOW_UNVERIFIED = process.env.ALLOW_UNVERIFIED_INBOUND === "true";

/* ---------- Postmark types (subset) ---------- */
type PMAddress = { Email?: string; Name?: string; MailboxHash?: string };
type PMAttachment = {
  Name?: string;
  Content?: string;       // base64
  ContentType?: string;   // "application/pdf"
  ContentLength?: number;
};
type PMInbound = {
  From?: string;
  FromFull?: PMAddress;
  To?: string;
  ToFull?: PMAddress[];
  Subject?: string;
  HtmlBody?: string;
  TextBody?: string;
  MailboxHash?: string;   // our UUID tagging slot
  Attachments?: PMAttachment[];
  Headers?: Array<{ Name?: string; Value?: string }>;
};

/* ---------- helpers ---------- */

function firstAddress(v?: string): string | undefined {
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

function headerValue(payload: any, name: string): string | undefined {
  const arr: Array<{ Name?: string; Value?: string }> | undefined = payload?.Headers;
  return arr?.find((h) => h?.Name?.toLowerCase() === name.toLowerCase())?.Value;
}

async function readJson(req: VercelRequest): Promise<any> {
  if (req.body && typeof req.body === "object") return req.body;
  const raw = await new Promise<string>((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => resolve(buf));
    req.on("error", reject);
  });
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

/** very light webhook token check (optional) */
function verifyWebhookToken(req: VercelRequest): boolean {
  if (!INBOUND_TOKEN) return ALLOW_UNVERIFIED; // testing mode
  const got =
    (req.headers["x-postmark-webhook-token"] as string) ||
    (req.headers["x-webhook-token"] as string) ||
    "";
  return got === INBOUND_TOKEN;
}

/** first absolute URL in Html/Text that looks merchant-ish */
function candidateProductLink(payload: PMInbound, merchant: string): string | null {
  const blob = `${payload.HtmlBody || ""}\n${payload.TextBody || ""}`;
  const urls = [...blob.matchAll(/\bhttps?:\/\/[^\s"'<>]+/gi)].map((m) => m[0]);
  if (!urls.length) return null;
  const merchantClean = (merchant || "").toLowerCase().replace(/^www\./, "");
  const pri = urls.find((u) => u.toLowerCase().includes(merchantClean));
  return (pri || urls[0]) ?? null;
}

/* ---------- main handler ---------- */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    // small readiness ping to make debugging easier
    return res.status(200).json({ ok: true, info: "postmark inbound ready" });
  }

  if (!verifyWebhookToken(req)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const payload: PMInbound = await readJson(req);
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

  // 1) resolve user id (MailboxHash UUID or plus-address), else default
  let userId =
    sanitizeUuid(payload.MailboxHash) ||
    sanitizeUuid(payload.FromFull?.MailboxHash);
  if (!isUuid(userId)) {
    const toEmail = firstAddress(payload.To);
    const plusMatch = toEmail?.match(/\+([^@]+)@/);
    userId = sanitizeUuid(plusMatch?.[1]);
  }
  if (!isUuid(userId)) userId = DEFAULT_USER;
  if (!isUuid(userId)) {
    return res.status(200).json({ ok: true, ignored: true, reason: "no user uuid" });
  }

  // 2) pull the PDF
  const pdfAtt = (payload.Attachments || []).find((a) =>
    (a.ContentType || "").toLowerCase().includes("pdf")
  );
  if (!pdfAtt?.Content) {
    return res.status(200).json({ ok: true, ignored: true, reason: "no pdf attachment" });
  }
  const pdfBuf = Buffer.from(pdfAtt.Content, "base64");

  // 3) parse PDF for totals/items
  const parsed = await parseHmPdf(pdfBuf);

  // merchant hint (fallback to sender domain)
  const fromDomain =
    (firstAddress(payload.From)?.split("@")[1] || "unknown").toLowerCase();
  const merchant = (parsed.merchant || fromDomain).toLowerCase();

  // 4) store PDF in Supabase Storage
  const safeName =
    (parsed.receipt_number || parsed.order_number || "receipt")
      .toLowerCase()
      .replace(/[^a-z0-9\-_.]+/g, "-");
  const objectPath = `${userId}/${Date.now()}-${safeName}.pdf`;

  const { error: upErr } = await sb.storage
    .from(RECEIPTS_BUCKET)
    .upload(objectPath, pdfBuf, { contentType: "application/pdf", upsert: true });
  if (upErr) {
    console.error("[inbound] storage upload error:", upErr);
  }

  // 5) upsert into receipts (conflict on a sane natural key)
  const receiptRow = {
    user_id: userId,
    merchant,
    order_id: parsed.order_number || "",
    purchase_date: parsed.order_date ? parsed.order_date.slice(0, 10) : null,
    total_cents: parsed.total_cents,
    tax_cents: parsed.tax_cents ?? null,
    shipping_cents: parsed.shipping_cents ?? null,
    currency: "USD",
    raw_url: null as string | null,
    raw_json: {
      source: "postmark",
      object_path: objectPath,
      attachment_name: pdfAtt.Name || "receipt.pdf",
      headers: payload.Headers || [],
    } as any,
  };

  const { data: rUp, error: rErr } = await sb
    .from("receipts")
    .upsert(receiptRow, {
      onConflict: "user_id,merchant,order_id,purchase_date",
    })
    .select("id")
    .single();

  if (rErr) {
    console.error("[inbound] receipts.upsert:", rErr);
    return res.status(500).json({ ok: false, error: rErr.message || String(rErr) });
  }

  const receiptId = rUp?.id as string;

  // 6) line_items — replace existing set for this receipt
  let liInserted = 0;
  if (receiptId && parsed.line_items?.length) {
    await sb.from("line_items").delete().eq("receipt_id", receiptId);
    const rows = parsed.line_items.map((li) => ({
      receipt_id: receiptId,
      description: li.desc,
      qty: li.qty ?? 1,
      unit_cents: li.unit_cents ?? null,
      total_cents: li.total_cents ?? null,
    }));
    const { error: liErr } = await sb.from("line_items").insert(rows);
    if (liErr) console.error("[inbound] line_items.insert:", liErr);
    else liInserted = rows.length;
  }

  // 7) products — only when we have a plausible UPC
  let prodInserted = 0;
  if (parsed.line_items?.length) {
    const prodRows = parsed.line_items
      .filter((li) => li.upc)
      .map((li) => ({
        user_id: userId,
        brand: merchant,
        model: li.desc,
        upc: li.upc!,
      }));
    if (prodRows.length) {
      const { error: pErr } = await sb.from("products").insert(prodRows);
      if (pErr) console.warn("[inbound] products.insert:", pErr.message);
      else prodInserted = prodRows.length;
    }
  }

  // 8) product_links — try to infer one reasonable URL
  let linkInserted = 0;
  const link = candidateProductLink(payload, merchant);
  if (link && receiptId) {
    const { error: lErr } = await sb
      .from("product_links")
      .upsert(
        [
          {
            receipt_id: receiptId,
            url: link,
            merchant_hint: merchant,
            selector: null,
            active: true,
          },
        ],
        { onConflict: "receipt_id,url" }
      );
    if (lErr) console.warn("[inbound] product_links.upsert:", lErr.message);
    else linkInserted = 1;
  }

  return res.status(200).json({
    ok: true,
    receipt_id: receiptId,
    pdf: { stored: !upErr, path: objectPath },
    parsed: {
      merchant,
      order_number: parsed.order_number,
      total_cents: parsed.total_cents,
      tax_cents: parsed.tax_cents ?? null,
      shipping_cents: parsed.shipping_cents ?? null,
      line_items: parsed.line_items?.length ?? 0,
    },
    fanout: {
      line_items: liInserted,
      products: prodInserted,
      product_links: linkInserted,
    },
  });
}
