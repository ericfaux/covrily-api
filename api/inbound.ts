// api/inbound.ts
// Accepts Postmark Inbound webhook. Also responds 200 to GET/HEAD so the Postmark "Check" passes.

import { supabaseAdmin } from "../lib/supabase-admin";
import { naiveParse } from "../lib/parse";
import { computeReturnDeadline } from "../lib/policies";

export default async function handler(req: any, res: any) {
  try {
    // Allow Postmark's "Check" (often GET or HEAD) to succeed
    if (req.method !== "POST") {
      return res.status(200).json({ ok: true, info: "inbound webhook ready" });
    }

    // Expect JSON body from Postmark
    const payload = req.body as any;
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "Missing or invalid JSON body" });
    }

    // We route by MailboxHash from addresses like: abcd+<USER_ID>@inbound.postmarkapp.com
    const userId = payload?.MailboxHash?.toString();
    if (!userId) {
      return res.status(400).json({
        error: "Missing MailboxHash. Use abcd+<USER_ID>@inbound.postmarkapp.com as recipient"
      });
    }

    const from = payload?.From || "";
    const text = payload?.TextBody || "";
    const html = payload?.HtmlBody || "";

    // 1) Store raw inbound for audit/debug
    await supabaseAdmin.from("inbound_emails").insert({
      user_id: userId,
      provider: "postmark",
      payload
    });

    // 2) Naive parse → create a receipt row
    const parsed = naiveParse(text || html, from);
    const { data: receipt, error: rErr } = await supabaseAdmin
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
    if (rErr) throw rErr;

    // 3) Optional simple deadline rule (Best Buy 15 days)
    const dueAt =
      parsed.purchase_date &&
      computeReturnDeadline(parsed.merchant, parsed.purchase_date);

    if (dueAt) {
      await supabaseAdmin.from("deadlines").insert({
        user_id: userId,
        receipt_id: receipt.id,
        type: "return",
        due_at: dueAt.toISOString(),
        status: "open"
      });
    }

    return res.status(200).json({ ok: true, receipt_id: receipt.id, deadline_created: Boolean(dueAt) });
  } catch (e: any) {
    console.error("INBOUND_ERROR:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
