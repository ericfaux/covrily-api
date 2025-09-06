// api/inbound.ts
// Always 200 for checks (GET/HEAD or POST without MailboxHash). Write to DB only for real events.

import { supabaseAdmin } from "../lib/supabase-admin";
import { naiveParse } from "../lib/parse";
import { computeReturnDeadline } from "../lib/policies";

async function readRaw(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c: any) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") {
      return res.status(200).json({ ok: true, info: "inbound webhook ready" });
    }

    // Parse body safely
    let payload: any = req.body;
    if (!payload) {
      const raw = await readRaw(req);
      try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }
    } else if (typeof payload === "string") {
      try { payload = JSON.parse(payload); } catch { payload = null; }
    }

    // If no payload or no MailboxHash → treat as Postmark check
    const userId = payload?.MailboxHash?.toString?.();
    if (!payload || !userId) {
      return res.status(200).json({ ok: true, info: "check (no MailboxHash)" });
    }

    const from = payload?.From || "";
    const text = payload?.TextBody || "";
    const html = payload?.HtmlBody || "";

    // 1) Store raw inbound
    const insInbound = await supabaseAdmin.from("inbound_emails").insert({
      user_id: userId, provider: "postmark", payload
    });
    if (insInbound.error) {
      console.error("DB inbound_emails insert error:", insInbound.error);
      return res.status(500).json({ error: "DB inbound_emails", details: insInbound.error.message });
    }

    // 2) Parse → save receipt
    const parsed = naiveParse(text || html, from);
    const insReceipt = await supabaseAdmin.from("receipts").insert({
      user_id: userId,
      merchant: parsed.merchant,
      order_id: parsed.order_id,
      total_cents: parsed.total_cents,
      purchase_date: parsed.purchase_date,
      channel: "email",
      raw_json: payload
    }).select().single();
    if (insReceipt.error) {
      console.error("DB receipts insert error:", insReceipt.error);
      return res.status(500).json({ error: "DB receipts", details: insReceipt.error.message });
    }

    // 3) Optional deadline rule
    const receipt = insReceipt.data;
    const dueAt = parsed.purchase_date && computeReturnDeadline(parsed.merchant, parsed.purchase_date);
    if (dueAt) {
      const insDeadline = await supabaseAdmin.from("deadlines").insert({
        user_id: userId, receipt_id: receipt.id,
        type: "return", due_at: dueAt.toISOString(), status: "open"
      });
      if (insDeadline.error) console.error("DB deadlines insert error:", insDeadline.error);
    }

    return res.status(200).json({ ok: true, receipt_id: receipt.id, deadline_created: Boolean(dueAt) });
  } catch (e: any) {
    console.error("INBOUND_ERROR:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
