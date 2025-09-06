// api/cron/due-today.ts
// Scans deadlines due in the next 24h and emails users once.

import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../../lib/postmark";

export default async function handler(req: any, res: any) {
  try {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(url, key, { auth: { persistSession: false } });

    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Find open deadlines due within 24h that we haven't notified yet
    const { data: due, error } = await supabase
      .from("deadlines")
      .select("id,user_id,receipt_id,type,due_at,status,last_notified_at")
      .eq("status", "open")
      .is("last_notified_at", null)
      .lt("due_at", in24h.toISOString());

    if (error) throw error;

    const dryRun = String(req.query?.dryRun || "").toLowerCase() === "1";
    let processed = 0;

    for (const d of due || []) {
      // Get receipt context
      const { data: receipt } = await supabase
        .from("receipts")
        .select("merchant,purchase_date,total_cents,user_id")
        .eq("id", d.receipt_id)
        .single();

      // Get user email using Admin API (service role)
      const { data: userResp } = await supabase.auth.admin.getUserById(d.user_id);
      const email = userResp?.user?.email;
      if (!email) continue;

      const subject =
        `Reminder: ${receipt?.merchant ?? "your purchase"} ` +
        `return window ends ${new Date(d.due_at).toLocaleString()}`;

      const amount = receipt?.total_cents != null
        ? `$${(receipt.total_cents / 100).toFixed(2)}`
        : "";

      const text =
`Heads up!

Your ${receipt?.merchant ?? "purchase"} from ${receipt?.purchase_date ?? "recently"} ${amount ? ` (${amount})` : ""} is approaching the return deadline.
Deadline: ${new Date(d.due_at).toLocaleString()}.

Open Covrily to review and decide: return or keep.`;

      if (!dryRun) {
        await sendEmail(email, subject, text);
        await supabase
          .from("deadlines")
          .update({ last_notified_at: new Date().toISOString() })
          .eq("id", d.id);
      }

      processed++;
    }

    return res.status(200).json({ ok: true, processed, dryRun });
  } catch (e: any) {
    console.error("CRON_DUE_TODAY_ERROR", e);
    // Keep returning 200 so cron doesn’t spam retries; use logs to debug
    return res.status(200).json({ ok: false, error: e?.message || "error" });
  }
}
