// api/gmail/ingest.ts
// Fetch unread Gmail messages for approved merchants and store receipts

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";
import parsePdf from "../../lib/pdf.js";
import { naiveParse, type ParsedReceipt } from "../../lib/parse.js";
import { supabaseAdmin } from "../../lib/supabase-admin.js";
import { getAccessToken } from "../../lib/gmail-scan.js";
import { withRetry } from "../../lib/retry.js";
import extractReceipt from "../../lib/llm/extract-receipt.js";
import { logParseResult } from "../../lib/parse-log.js";
import extractReceiptLink from "../../lib/llm/extract-receipt-link.js";
import { load } from "cheerio";

export const config = { runtime: "nodejs" };

function b64ToBuf(b64: string): Buffer {
  const norm = b64.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(norm, "base64");
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function findPdfPart(part: any): any | null {
  if (!part) return null;
  if (part.mimeType === "application/pdf") return part;
  if (Array.isArray(part.parts)) {
    for (const p of part.parts) {
      const found = findPdfPart(p);
      if (found) return found;
    }
  }
  return null;
}

function findHtmlPart(part: any): any | null {
  if (!part) return null;
  if (part.mimeType === "text/html") return part;
  if (Array.isArray(part.parts)) {
    for (const p of part.parts) {
      const found = findHtmlPart(p);
      if (found) return found;
    }
  }
  return null;
}

function gatherAnchors(html: string): string[] {
  const $ = load(html);
  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href) links.push(href);
  });
  return links;
}

async function findReceiptLink(payload: any, from: string): Promise<string | null> {
  const htmlPart = findHtmlPart(payload);
  const data = htmlPart?.body?.data;
  if (!data) return null;
  const html = b64ToBuf(data).toString("utf8");
  const links = gatherAnchors(html);
  if (links.length === 0) return null;
  const senderDomain = (from.match(/@([^>\s]+)/)?.[1] || "").toLowerCase();
  const filtered = links.filter((url) => {
    try {
      const u = new URL(url);
      const domainMatch = senderDomain && u.hostname.toLowerCase().endsWith(senderDomain);
      const keywordMatch = /(order|receipt|invoice|view)/i.test(url);
      return domainMatch || keywordMatch;
    } catch {
      return false;
    }
  });
  if (filtered.length === 0) return null;
  if (filtered.length === 1) return filtered[0];
  return await extractReceiptLink(filtered);
}

function extractText(part: any): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) {
    return b64ToBuf(part.body.data).toString("utf8");
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return stripHtml(b64ToBuf(part.body.data).toString("utf8"));
  }
  if (Array.isArray(part.parts)) {
    return part.parts.map((p: any) => extractText(p)).join("\n");
  }
  return "";
}

async function isReceiptLLM(text: string): Promise<boolean> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return true;
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "Determine if the following email is a purchase receipt. Respond with yes or no." },
          { role: "user", content: text.slice(0, 4000) },
        ],
        max_tokens: 1,
      }),
    });
    const data: any = await resp.json();
    const answer = data?.choices?.[0]?.message?.content?.toLowerCase() || "";
    return answer.includes("yes");
  } catch {
    return true;
  }
}

async function processMessage(
  gmail: any,
  userId: string,
  merchant: string,
  messageId: string
): Promise<void> {
  let full;
  try {
    full = await withRetry(
      () =>
        gmail.users.messages.get({
          userId: "me",
          id: messageId,
          format: "full",
        }),
      "users.messages.get"
    );
  } catch {
    return;
  }

  const payload = full.data.payload || {};
  const headers = payload.headers || [];
  const subject = headers.find((h: any) => (h.name || "").toLowerCase() === "subject")?.value || "";
  const from = headers.find((h: any) => (h.name || "").toLowerCase() === "from")?.value || "";

  const text = extractText(payload);
  const combined = `${subject}\n${text}`;
  const isReceipt = await isReceiptLLM(combined);
  if (!isReceipt) return;

  const receiptLink = await findReceiptLink(payload, from);
  if (receiptLink) (full.data as any).receipt_link = receiptLink;

  let parsed: ParsedReceipt | null = null;
  let fromPdf = false;

  const pdfPart = findPdfPart(payload);
  if (pdfPart) {
    let buf: Buffer | null = null;
    if (pdfPart.body?.attachmentId) {
      const att = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: pdfPart.body.attachmentId,
      });
      const data = att.data.data as string | undefined;
      if (data) buf = b64ToBuf(data);
    } else if (pdfPart.body?.data) {
      buf = b64ToBuf(pdfPart.body.data);
    }
    if (buf) {
      parsed = await parsePdf(buf);
      fromPdf = true;
    }
  }

  if (!parsed) {
    parsed = naiveParse(combined, from);
  }

  let {
    merchant: m,
    order_id,
    purchase_date,
    total_cents,
    tax_cents,
    shipping_cents,
  } = parsed as any;

  const needsReceipt =
    !m ||
    m === "unknown" ||
    !order_id ||
    !purchase_date ||
    total_cents == null ||
    tax_cents == null ||
    shipping_cents == null;

  if (needsReceipt) {
    const excerpt = (parsed as any).text_excerpt;
    const llmText = [subject, combined, excerpt].filter(Boolean).join("\n\n");
    const llm = await extractReceipt(llmText);
    if (llm) {
      if ((!m || m === "unknown") && llm.merchant) m = llm.merchant.toLowerCase();
      if (!order_id && llm.order_id) order_id = llm.order_id;
      if (!purchase_date && llm.purchase_date) purchase_date = llm.purchase_date;
      if (total_cents == null && llm.total_cents != null) total_cents = llm.total_cents;
      if (tax_cents == null && llm.tax_cents != null) tax_cents = llm.tax_cents;
      if (shipping_cents == null && llm.shipping_cents != null)
        shipping_cents = llm.shipping_cents;
    }
  }

  await logParseResult({
    parser: fromPdf ? "pdf" : "naive",
    merchant: m || "unknown",
    order_id_found: !!order_id,
    purchase_date_found: !!purchase_date,
    total_cents_found: total_cents != null,
  });

  const up = await supabaseAdmin
    .from("receipts")
    .upsert(
      [
        {
          user_id: userId,
          merchant: m || merchant,
          order_id: order_id || "",
          purchase_date: purchase_date || null,
          total_cents: total_cents ?? null,
          tax_cents: tax_cents ?? null,
          shipping_cents: shipping_cents ?? null,
          raw_json: full.data,
        },
      ],
      { onConflict: "user_id,merchant,order_id,purchase_date" }
    )
    .select("id")
    .single();

  const receiptId = up.data?.id;
  const items: any[] = (parsed as any).items || [];
  if (receiptId && Array.isArray(items) && items.length > 0) {
    const payloadItems = items.map((it) => ({
      receipt_id: receiptId,
      name: it.name || "",
      qty: it.qty || 1,
      unit_cents: it.unit_cents ?? null,
    }));
    await supabaseAdmin.from("line_items").delete().eq("receipt_id", receiptId);
    await supabaseAdmin.from("line_items").insert(payloadItems);
  }

  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { removeLabelIds: ["UNREAD"] },
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET,POST");
    return res.status(405).end();
  }

  const userFilter = (req.query.user as string) || "";
  let query = supabaseAdmin
    .from("approved_merchants")
    .select("user_id, merchant");
  if (userFilter) query = query.eq("user_id", userFilter);
  const { data, error } = await query;

  if (error || !data) {
    return res.status(500).json({ ok: false, error: error?.message });
  }

  for (const row of data) {
    const userId = row.user_id as string;
    const merchant = row.merchant as string;
    const tokens = await getAccessToken(userId);
    if (!tokens) continue;
    const gmail = google.gmail({ version: "v1", auth: tokens.client });

    const query = `from:${merchant} is:unread`;
    const list = await withRetry(
      () => gmail.users.messages.list({ userId: "me", q: query }),
      "users.messages.list"
    );
    const msgs = list.data.messages || [];
    for (const msg of msgs) {
      if (!msg.id) continue;
      await processMessage(gmail, userId, merchant, msg.id);
    }
  }

  return res.status(200).json({ ok: true });
}

