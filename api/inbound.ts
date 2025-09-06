// api/inbound.ts
// Postmark Inbound webhook → stores raw email, creates a receipt, and (if applicable) a return deadline.

import { supabaseAdmin } from "../lib/supabase-admin";
import { naiveParse } from "../lib/parse";
import { computeReturnDeadline } from "../lib/policies";

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    // Postmark sends JSON. We rely on req.body being a parsed object.
    const payload = req.body as any;
    if (!payload) return res.status(400).json({ error: "Missing JSON body" });

    // We expect emails to be sent to: abcd+<USER_ID>@inbound.postmarkapp.com
    // Postmark then places <USER_ID> into `MailboxHash`.
    const userId = payload?.MailboxHash?.toString();
    if (!userId) {
      return res.status(400).json({
        error: "Missing MailboxHash. Ensure recipient is abcd+<USER_ID>@inbound.postmarkapp.com"
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
        merchant: parsed.merchant,          // e.g., "bestbuy.com"
        order_id: parsed.order_id,
        total_cents: parsed.total_cents,
        purchase_date: parsed.purchase_date,
        channel: "email",
        raw_json: payload
      })
      .select()
      .single();
    if (rErr) throw rErr;

    // 3) Create a return deadline if our simple rule applies
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
    console.error(e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
