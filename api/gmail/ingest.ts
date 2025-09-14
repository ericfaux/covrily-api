// api/gmail/ingest.ts
// Fetch unread Gmail messages for authorized merchants and store receipts

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";
import parsePdf from "../../lib/pdf.js";
import { naiveParse, type ParsedReceipt } from "../../lib/parse.js";
import { supabaseAdmin } from "../../lib/supabase-admin.js";
import { getAccessToken } from "../../lib/gmail-scan.js";

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

async function processMessage(
  gmail: any,
  userId: string,
  merchant: string,
  messageId: string
): Promise<void> {
  const full = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const payload = full.data.payload || {};
  const headers = payload.headers || [];
  const subject = headers.find((h: any) => (h.name || "").toLowerCase() === "subject")?.value || "";
  const from = headers.find((h: any) => (h.name || "").toLowerCase() === "from")?.value || "";

  let parsed: ParsedReceipt | null = null;

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
    if (buf) parsed = await parsePdf(buf);
  }

  if (!parsed) {
    const text = extractText(payload);
    parsed = naiveParse(`${subject}\n${text}`, from);
  }

  const { merchant: m, order_id, purchase_date, total_cents } = parsed;
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

  const { data, error } = await supabaseAdmin
    .from("auth_merchants")
    .select("user_id, merchant");

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
    const list = await gmail.users.messages.list({ userId: "me", q: query });
    const msgs = list.data.messages || [];
    for (const msg of msgs) {
      if (!msg.id) continue;
      await processMessage(gmail, userId, merchant, msg.id);
    }
  }

  return res.status(200).json({ ok: true });
}

