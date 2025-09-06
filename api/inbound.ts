// api/inbound.ts
// Postmark Inbound webhook.
// - Always 200 for checks (GET/HEAD or POST without JSON/MailboxHash)
// - Only writes to Supabase when MailboxHash (<USER_ID>) is present.

import { createClient } from "@supabase/supabase-js";
import { naiveParse } from "../lib/parse";
import { computeReturnDeadline } from "../lib/policies";

export default async function handler(req: any, res: any) {
  try {
    // 1) Treat non-POST as a health check
    if (req.method !== "POST") {
      return res.status(200).json({ ok: true, info: "inbound webhook ready" });
    }

    // 2) Some "Check" requests POST without JSON. If it's not JSON, treat as a check.
    const ctype = (req.headers?.["content-type"] || "").toLowerCase();
    const isJson = ctype.includes("application/json");
    if (!isJson || !req.body) {
      return res.status(200).json({ ok: true, info: "check (no JSON body)" });
    }

    // 3) If body is a string, try to parse; if it fails, treat as a check.
    let payload: any = req.body;
    if (typeof payload === "string") {
      try { payload = JSON.parse(payload); } catch { return res.status(200).json({ ok: true, info: "check (invalid JSON)" }); }
    }
    if (!payload || typeof payload !== "object") {
      return res.status(200).json({ ok: true, info: "check (missing payload)" });
    }

    // 4) Real events must have MailboxHash (we use the +<USER_ID> part)
    const userId = payload?.MailboxHash ? String(payload.MailboxHash) : null;
    if (!userId) {
      return res.status(200).json({ ok: true, info: "check (no MailboxHash)" });
    }

    // 5) Create Supabase admin client lazily
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      console.error("MISSING_SUPABASE_ENV");
      return res.status(200).json({ ok: true, info: "check (missing env)" });
    }
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const from = payload?.From || "";
    const text = payload?.TextBody || "";
    const html = payload?.HtmlBody || "";

    // 6) Store raw inbound
    const insInbound = await supabase.from("inbound_emails").insert({
      user_id: userId,
      provider: "postmark",
      payload
    });
    if (insInbound.error) {
      console.error("DB inbound_emails insert error:", insInbound.error);
      // Still return 200 so Postmark doesn't keep retrying; we log for debugging.
      return res.status(200).json({ ok: false, info: "db inbound_emails error" });
    }

    // 7) Parse → create receipt
    const parsed = naiveParse(text || html, from);
    const insReceipt = await supabase.from("receipts").insert({
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
      return res.status(200).json({ ok: false, info: "db receipts error" });
    }

    // 8) Optional: deadline (demo rule)
    const receipt = insReceipt.data;
    const dueAt = parsed.purchase_date && computeReturnDeadline(parsed.merchant, parsed.purchase_date);
    if (dueAt) {
      const insDeadline = await supabase.from("deadlines").insert({
        user_id: userId, receipt_id: receipt.id,
        type: "return", due_at: dueAt.toISOString(), status: "open"
      });
      if (insDeadline.error) console.error("DB deadlines insert error:", insDeadline.error);
    }

    return res.status(200).json({ ok: true, receipt_id: receipt.id, deadline_created: Boolean(dueAt) });
  } catch (e: any) {
    console.error("INBOUND_ERROR:", e);
    // Return 200 so Postmark doesn't keep retrying; we use logs to debug.
    return res.status(200).json({ ok: false, info: "exception", error: e?.message || "error" });
  }
}
