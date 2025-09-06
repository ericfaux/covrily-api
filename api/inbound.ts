import { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../lib/supabase-admin";
import { naiveParse } from "../lib/parse";
import { computeReturnDeadline } from "../lib/policies";

/**
 * Expects Postmark Inbound JSON.
 * We route by MailboxHash from addresses like: abcd+<USER_ID>@inbound.postmarkapp.com
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const payload = req.body as any;
    if (!payload) return res.status(400).json({ error: "Missing JSON body" });

    const userId = payload?.MailboxHash?.toString();
    const from = payload?.From || "";
    const text = payload?.TextBody || "";
    const html = payload?.HtmlBody || "";

    if (!userId) {
      return res.status(400).json({
        error: "Missing MailboxHash. Ensure recipient is abcd+<USER_ID>@inbound.postmarkapp.com"
      });
    }

    // Save raw inbound for audit/debug
    await supabaseAdmin.from("inbound_emails").insert({
      user_id: userId,
      provider: "postmark",
      payload
    });

    // Parse → store receipt
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

    // Create a return deadline if rule matched
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

    return res.status(200).json({ ok: true, receipt_id: receipt.id });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
