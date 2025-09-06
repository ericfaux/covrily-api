// api/inbound.ts
// Robust Postmark Inbound webhook: handles GET/HEAD checks and parses body if it's string/buffer/undefined.

import { supabaseAdmin } from "../lib/supabase-admin";
import { naiveParse } from "../lib/parse";
import { computeReturnDeadline } from "../lib/policies";

// Read raw body (for cases where req.body is undefined)
async function readRaw(req: any): Promise<string> {
  return await new Promise((resolve, reject) => {
    try {
      let data = "";
      req.on("data", (chunk: any) => (data += chunk));
      req.on("end", () => resolve(data));
      req.on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}

export default async function handler(req: any, res: any) {
  try {
    // Allow Postmark "Check" (GET/HEAD) to succeed
    if (req.method !== "POST") {
      return res.status(200).json({ ok: true, info: "inbound webhook ready" });
    }

    // ---- Parse body safely ----
    let payload: any = req.body;
    if (!payload) {
      const raw = await readRaw(req);
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        return res.status(400).json({ error: "Invalid JSON body" });
      }
    } else if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        return res.status(400).json({ error: "Invalid JSON string" });
      }
    }

    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "Missing or invalid JSON body" });
    }

    // We route by the +<USER_ID> part (MailboxHash)
    const userId = payload?.MailboxHash?.toString();
    if (!userId) {
      return res.status(400).json({
        error: "Missing MailboxHash. Send to abcd+<USER_ID>@inbound.postmarkapp.com"
      });
    }

    const from = payload?.From || "";
    const text = payload?.TextBody || "";
    const html = payload?.HtmlBody || "";

    // 1) Store raw inbound (check for FK errors)
    const insInbound = await supabaseAdmin.from("inbound_emails").insert({
      user_id: userId,
      provider: "postmark",
      payload
    });
    if (insInbound.error) {
      console.error("DB inbound_emails insert error:", insInbound.error);
      return res.status(400).json({ error: "DB inbound_emails", details: insInbound.error.message });
    }

    // 2) Parse → store receipt
    const parsed = naiveParse(text || html, from);
    const insReceipt = await supabaseAdmin
      .from("receipts")
      .insert({
        user_id: userId,
        merchant: parsed.merchant,
        order_id: parsed.order_id,
        total_cents: parsed.total_cents,
        purchase_date: parsed.purchase_date,
        channel: "email",
        raw_json: payload
      })
      .select()
      .single();
    if (insReceipt.error) {
      console.error("DB receipts insert error:", insReceipt.error);
      return res.status(400).json({ error: "DB receipts", details: insReceipt.error.message });
    }
    const receipt = insReceipt.data;

    // 3) Optional deadline rule (Best Buy demo)
    const dueAt =
      parsed.purchase_date &&
      computeReturnDeadline(parsed.merchant, parsed.purchase_date);

    if (dueAt) {
      const insDeadline = await supabaseAdmin.from("deadlines").insert({
        user_id: userId,
        receipt_id: receipt.id,
        type: "return",
        due_at: dueAt.toISOString(),
        status: "open"
      });
      if (insDeadline.error) {
        console.error("DB deadlines insert error:", insDeadline.error);
      }
    }

    return res.status(200).json({
      ok: true,
      receipt_id: receipt.id,
      merchant: parsed.merchant,
      deadline_created: Boolean(dueAt)
    });
  } catch (e: any) {
    console.error("INBOUND_ERROR:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
