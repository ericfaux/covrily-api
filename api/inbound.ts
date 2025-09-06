// api/inbound.ts
// Accepts Postmark Inbound webhook. Always 200 for checks (GET/HEAD or empty body).
import { supabaseAdmin } from "../lib/supabase-admin";
import { naiveParse } from "../lib/parse";
import { computeReturnDeadline } from "../lib/policies";

// Read raw body if req.body is undefined (some runtimes)
async function readRaw(req: any): Promise<string> {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c: any) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req: any, res: any) {
  try {
    // Postmark "Check" often uses GET/HEAD → succeed
    if (req.method !== "POST") {
      return res.status(200).json({ ok: true, info: "inbound webhook ready" });
    }

    // ---- Parse body safely ----
    let payload: any = req.body;
    if (!payload) {
      const raw = await readRaw(req);
      if (!raw) {
        // Treat empty body as a health check
        return res.status(200).json({ ok: true, info: "check (no body)" });
      }
      try { payload = JSON.parse(raw); } catch {
        // Also treat invalid JSON as a check
        return res.status(200).json({ ok: true, info: "check (invalid json)" });
      }
    } else if (typeof payload === "string") {
      try { payload = JSON.parse(payload); } catch {
        return res.status(200).json({ ok: true, info: "check (invalid json str)" });
      }
    }

    // Real event: must have MailboxHash (the +<USER_ID> part)
    const userId = payload?.MailboxHash?.toString();
    if (!userId) {
      return res.status(400).json({
        error: "Missing MailboxHash. Send to abcd+<USER_ID>@inbound.postmarkapp.com"
      });
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
      return res.status(400).json({ error: "DB inbound_emails", details: insInbound.error.message });
    }

    // 2) Parse → create receipt
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
      return res.status(400).json({ error: "DB receipts", details: insReceipt.error.message });
    }

    // 3) Optional deadline rule (Best Buy demo)
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
