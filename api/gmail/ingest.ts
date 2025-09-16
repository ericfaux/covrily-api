// api/gmail/ingest.ts
// Fetch Gmail messages for approved merchants and store receipts

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";
import parsePdf from "../../lib/pdf.js";
import { naiveParse, type ParsedReceipt } from "../../lib/parse.js";
import { supabaseAdmin } from "../../lib/supabase-admin.js";
import { getAccessToken } from "../../lib/gmail-scan.js";
import { withRetry } from "../../lib/retry.js";
import extractReceipt from "../../lib/llm/extract-receipt.js";
import { logParseResult } from "../../lib/parse-log.js";
import extractReceiptLink, {
  type ReceiptLinkCandidate,
} from "../../lib/llm/extract-receipt-link.js";
import { load } from "cheerio";

export const config = { runtime: "nodejs" };

const PROCESSED_LABEL_NAME = "CovrilyProcessed";

interface AnchorCandidate {
  href: string;
  text: string;
  score: number;
}

function hasReceiptIndicators(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  const keywordRegex = /(receipt|invoice|order|purchase|confirmation|payment)/i;
  const viewRegex = /view (?:your )?(?:order|receipt|invoice|purchase|details)/i;
  const idRegex =
    /(order|receipt|invoice|confirmation|transaction)[^\n]{0,20}(number|no\.?|#|id)?\s*[:#]?\s*[a-z0-9][a-z0-9-]{3,}/i;
  const amountRegex = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/;

  const hasKeyword = keywordRegex.test(text);
  const hasView = viewRegex.test(lower);
  const hasId = idRegex.test(text);
  const hasAmount = amountRegex.test(text);

  let score = 0;
  if (hasKeyword) score += 1;
  if (hasView) score += 1;
  if (hasId) score += 2;
  if (hasAmount) score += 2;

  return score >= 3 && hasAmount;
}

async function ensureProcessedLabel(gmail: any): Promise<string | null> {
  const lookup = async () => {
    const labelsResp: any = await withRetry(
      () => gmail.users.labels.list({ userId: "me" }),
      "users.labels.list"
    );
    const all = labelsResp?.data?.labels || [];
    const lowerName = PROCESSED_LABEL_NAME.toLowerCase();
    const match = all.find(
      (label: any) => (label.name || "").toLowerCase() === lowerName
    );
    return match?.id || null;
  };

  try {
    const existing = await lookup();
    if (existing) return existing;
  } catch (err) {
    console.warn("[gmail] labels.list failed", err);
  }

  try {
    const createdResp: any = await withRetry(
      () =>
        gmail.users.labels.create({
          userId: "me",
          requestBody: {
            name: PROCESSED_LABEL_NAME,
            labelListVisibility: "labelHide",
            messageListVisibility: "hide",
          },
        }),
      "users.labels.create"
    );
    const id = createdResp?.data?.id;
    if (id) return id;
  } catch (err) {
    console.warn("[gmail] labels.create failed", err);
  }

  try {
    return await lookup();
  } catch (err) {
    console.warn("[gmail] labels.list retry failed", err);
    return null;
  }
}

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

function gatherAnchors(html: string): AnchorCandidate[] {
  const $ = load(html);
  const links: AnchorCandidate[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const text = $(el)
      .text()
      .replace(/\s+/g, " ")
      .trim();
    links.push({ href, text, score: 0 });
  });
  return links;
}

async function findReceiptLink(
  payload: any,
  from: string
): Promise<string | null> {
  const htmlPart = findHtmlPart(payload);
  const data = htmlPart?.body?.data;
  if (!data) return null;
  const html = b64ToBuf(data).toString("utf8");
  const links = gatherAnchors(html);
  if (links.length === 0) return null;
  const senderDomain = (from.match(/@([^>\s]+)/)?.[1] || "").toLowerCase();
  const keywordRegex = /(order|receipt|invoice|purchase|view|details)/i;
  const viewRegex = /view (?:your )?(?:order|receipt|invoice|details)/i;
  const idRegex =
    /(order|receipt|invoice|confirmation)[^\n]{0,20}[:#]?\s*[a-z0-9][a-z0-9-]{3,}/i;

  const scored = links
    .map((link) => {
      let domainMatch = false;
      let urlKeyword = false;
      let validUrl = false;
      try {
        const u = new URL(link.href);
        validUrl = u.protocol === "http:" || u.protocol === "https:";
        domainMatch =
          !!senderDomain && u.hostname.toLowerCase().endsWith(senderDomain);
        urlKeyword = keywordRegex.test(link.href);
      } catch {
        domainMatch = false;
      }
      const textKeyword = keywordRegex.test(link.text);
      const viewMatch = viewRegex.test(link.text.toLowerCase());
      const idMatch = idRegex.test(link.text);
      const score =
        (domainMatch ? 3 : 0) +
        (urlKeyword ? 2 : 0) +
        (textKeyword ? 3 : 0) +
        (viewMatch ? 3 : 0) +
        (idMatch ? 1 : 0);
      return {
        ...link,
        score,
        domainMatch,
        textKeyword,
        urlKeyword,
        viewMatch,
        validUrl,
      };
    })
    .filter(
      (link) =>
        link.validUrl &&
        (link.domainMatch || link.urlKeyword || link.textKeyword || link.viewMatch)
    );

  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 1) return scored[0].href;

  const candidates: ReceiptLinkCandidate[] = scored.map((link) => ({
    url: link.href,
    anchorText: link.text,
  }));

  const llmChoice = await extractReceiptLink(candidates);
  if (llmChoice) return llmChoice;
  return scored[0].href;
}

export async function fetchReceiptFromLink(
  url: string,
  meta?: {
    user_id?: string;
    message_id?: string;
    merchant?: string;
    subject?: string;
    from?: string;
  }
): Promise<ParsedReceipt | null> {
  try {
    const resp = await withRetry(
      () => fetch(url, { redirect: "manual" }),
      "fetch receipt link"
    );

    const status = resp.status;

    if (
      status === 401 ||
      status === 403 ||
      (status === 302 && /login|signin/i.test(resp.headers.get("location") || ""))
    ) {
      try {
        await supabaseAdmin.from("pending_receipts").insert([
          {
            url,
            user_id: meta?.user_id || null,
            message_id: meta?.message_id || null,
            merchant: meta?.merchant || null,
            subject: meta?.subject || null,
            from_header: meta?.from || null,
            status_code: status,
          },
        ]);
      } catch (e) {
        console.error("[pending_receipts] insert failed:", e);
      }
      console.warn(
        `[fetch-receipt-link] authentication required (${status}) for ${url}`
      );
      return null;
    }

    if (!resp.ok) {
      console.warn(`[fetch-receipt-link] failed (${status}) for ${url}`);
      return null;
    }

    const type = resp.headers.get("content-type") || "";
    if (type.includes("application/pdf")) {
      const buf = Buffer.from(await resp.arrayBuffer());
      return await parsePdf(buf);
    }
    if (type.includes("text/html")) {
      const html = await resp.text();
      const text = stripHtml(html);
      const host = (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return "";
        }
      })();
      let parsed = naiveParse(text, `no-reply@${host}`);
      const needsReceipt =
        !parsed.merchant ||
        parsed.merchant === "unknown" ||
        !parsed.order_id ||
        !parsed.purchase_date ||
        parsed.total_cents == null;
      if (needsReceipt) {
        const llm = await extractReceipt(text);
        if (llm) {
          if ((!parsed.merchant || parsed.merchant === "unknown") && llm.merchant)
            parsed.merchant = llm.merchant.toLowerCase();
          if (!parsed.order_id && llm.order_id) parsed.order_id = llm.order_id;
          if (!parsed.purchase_date && llm.purchase_date)
            parsed.purchase_date = llm.purchase_date;
          if (parsed.total_cents == null && llm.total_cents != null)
            parsed.total_cents = llm.total_cents;
          if ((llm as any).tax_cents != null)
            (parsed as any).tax_cents = (llm as any).tax_cents;
          if ((llm as any).shipping_cents != null)
            (parsed as any).shipping_cents = (llm as any).shipping_cents;
        }
      }
      return parsed;
    }
    return null;
  } catch (e) {
    console.error(`[fetch-receipt-link] error for ${url}:`, e);
    return null;
  }
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
        model:
          process.env.OPENAI_CLASSIFIER_MODEL ||
          process.env.OPENAI_RECEIPT_MODEL ||
          "gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You decide whether an email either contains a purchase receipt or clearly links to one. " +
              "Answer 'yes' when the message references an order, invoice, or purchase and includes strong signals such as " +
              "currency amounts (e.g., $23.45), order or receipt numbers, or buttons/links like 'View order' or 'View receipt'. " +
              "If the email is purely marketing, informational, or lacks purchase evidence, respond 'no'. Respond with exactly 'yes' or 'no'.",
          },
          {
            role: "user",
            content:
              "Subject: Happy Place Maps order confirmation\nBody: Thanks for your purchase! Order #HPM-12345\nTotal: $27.50\nButton: View Order",
          },
          { role: "assistant", content: "yes" },
          {
            role: "user",
            content:
              "Subject: Storage payment receipt\nBody: Receipt Number 67890\nTotal Paid: $88.00 USD\nBalance: $0.00",
          },
          { role: "assistant", content: "yes" },
          {
            role: "user",
            content:
              "Subject: Summer deals are here!\nBody: Save 20% on your next order. View our catalogue for more details.",
          },
          { role: "assistant", content: "no" },
          { role: "user", content: text.slice(0, 6000) },
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
  messageId: string,
  processedLabelId?: string | null
): Promise<void> {
  let shouldLabel = false;
  let markRead = false;
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

  try {
    const payload = full.data.payload || {};
    const headers = payload.headers || [];
    const subject = headers.find((h: any) => (h.name || "").toLowerCase() === "subject")?.value || "";
    const from = headers.find((h: any) => (h.name || "").toLowerCase() === "from")?.value || "";
  
    const text = extractText(payload);
    const combined = `${subject}\n${text}`;
    const heuristicHit = hasReceiptIndicators(combined);
    let isReceipt = heuristicHit;
    if (!isReceipt) {
      isReceipt = await isReceiptLLM(combined);
    }
    if (!isReceipt) {
      shouldLabel = true;
      return;
    }
    shouldLabel = true;
    markRead = true;
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
  
    let receiptLink: string | null = null;
  
    let {
      merchant: m,
      order_id,
      purchase_date,
      total_cents,
      tax_cents,
      shipping_cents,
    } = parsed as any;
  
    let needsReceipt =
      !m ||
      m === "unknown" ||
      !order_id ||
      !purchase_date ||
      total_cents == null ||
      tax_cents == null ||
      shipping_cents == null;
  
    if (needsReceipt) {
      receiptLink = await findReceiptLink(payload, from);
      if (receiptLink) {
        (full.data as any).receipt_link = receiptLink;
        const linkParsed = await fetchReceiptFromLink(receiptLink, {
          user_id: userId,
          message_id: messageId,
          merchant: m || merchant,
          subject,
          from,
        });
        if (linkParsed) {
          if ((!m || m === "unknown") && linkParsed.merchant) {
            m = linkParsed.merchant.toLowerCase();
            if (!(parsed as any).merchant) (parsed as any).merchant = linkParsed.merchant;
          }
          if (!order_id && linkParsed.order_id) {
            order_id = linkParsed.order_id;
            if (!(parsed as any).order_id) (parsed as any).order_id = linkParsed.order_id;
          }
          if (!purchase_date && linkParsed.purchase_date) {
            purchase_date = linkParsed.purchase_date;
            if (!(parsed as any).purchase_date)
              (parsed as any).purchase_date = linkParsed.purchase_date;
          }
          if (total_cents == null && linkParsed.total_cents != null) {
            total_cents = linkParsed.total_cents;
            if ((parsed as any).total_cents == null)
              (parsed as any).total_cents = linkParsed.total_cents;
          }
          if (tax_cents == null && (linkParsed as any).tax_cents != null) {
            tax_cents = (linkParsed as any).tax_cents;
            if ((parsed as any).tax_cents == null)
              (parsed as any).tax_cents = (linkParsed as any).tax_cents;
          }
          if (shipping_cents == null && (linkParsed as any).shipping_cents != null) {
            shipping_cents = (linkParsed as any).shipping_cents;
            if ((parsed as any).shipping_cents == null)
              (parsed as any).shipping_cents = (linkParsed as any).shipping_cents;
          }
          if (!(parsed as any).items && (linkParsed as any).items)
            (parsed as any).items = (linkParsed as any).items;
        }
      }
    }
  
    needsReceipt =
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
            receipt_url: receiptLink,
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
  } finally {
    await modifyMessageLabels(
      gmail,
      messageId,
      processedLabelId ?? null,
      markRead,
      shouldLabel
    );
  }
}

async function modifyMessageLabels(
  gmail: any,
  messageId: string,
  processedLabelId: string | null,
  markRead: boolean,
  shouldLabel: boolean
) {
  const shouldModify = markRead || (shouldLabel && processedLabelId);
  if (!shouldModify) return;
  const requestBody: Record<string, any> = {};
  if (markRead) requestBody.removeLabelIds = ["UNREAD"];
  if (shouldLabel && processedLabelId) requestBody.addLabelIds = [processedLabelId];
  if (Object.keys(requestBody).length === 0) return;
  try {
    await gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody,
    });
  } catch (err) {
    console.warn("[gmail] failed to modify labels", err);
  }
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

  const processedLabelCache = new Map<string, string | null>();

  for (const row of data) {
    const userId = row.user_id as string;
    const merchant = row.merchant as string;
    const tokens = await getAccessToken(userId);
    if (!tokens) continue;
    const gmail = google.gmail({ version: "v1", auth: tokens.client });

    let processedLabelId = processedLabelCache.get(userId);
    if (processedLabelId === undefined) {
      processedLabelId = await ensureProcessedLabel(gmail);
      processedLabelCache.set(userId, processedLabelId ?? null);
    }

    const terms = [`from:${merchant}`];
    if (processedLabelId) {
      terms.push(`-label:${PROCESSED_LABEL_NAME}`);
    }
    const query = terms.join(" ");
    const list = await withRetry(
      () => gmail.users.messages.list({ userId: "me", q: query }),
      "users.messages.list"
    );
    const msgs = list.data.messages || [];
    for (const msg of msgs) {
      if (!msg.id) continue;
      await processMessage(gmail, userId, merchant, msg.id, processedLabelId);
    }
  }

  return res.status(200).json({ ok: true });
}

