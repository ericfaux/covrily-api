// api/cron/due-today.ts
import type { VercelRequest, VercelResponse } from "vercel";
import { createClient } from "@supabase/supabase-js";
import { sendMail } from "../lib/mail";

const url  = process.env.SUPABASE_URL!;
const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const to   = process.env.NOTIFY_TO!; // demo recipient

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in7d  = new Date(now.getTime() + 7  * 24 * 60 * 60 * 1000);
  const in8d  = new Date(now.getTime() + 8  * 24 * 60 * 60 * 1000);

  // 1) Due within 24h AND not notified recently
  const dueToday = await supabase
    .from("deadlines")
    .select(`
      id, due_at, status, receipt_id,
      receipts:receipt_id (merchant, order_id, purchase_date, total_cents)
    `)
    .eq("status", "open")
    .gte("due_at", now.toISOString())
    .lt("due_at", in24h.toISOString());

  // 2) About one week out
  const weekAhead = await supabase
    .from("deadlines")
    .select(`
      id, due_at, status, receipt_id,
      receipts:receipt_id (merchant, order_id, purchase_date, total_cents)
    `)
    .eq("status", "open")
    .gte("due_at", in7d.toISOString())
    .lt("due_at", in8d.toISOString());

  const sendFor = async (rows: any[], label: "today" | "week") => {
    for (const d of rows || []) {
      const r = d.receipts || {};
      const when = new Date(d.due_at);
      const subject =
        label === "today"
          ? `Reminder: ${r.merchant} return window ends ${when.toLocaleString()}`
          : `Heads up: ${r.merchant} return window is next week (${when.toLocaleDateString()})`;

      const body =
`Heads up!

Your ${r.merchant} from ${r.purchase_date ?? "unknown"} ($${(r.total_cents ?? 0)/100})
${label === "today" ? "is approaching the return deadline." : "has a return deadline in about a week."}
Deadline: ${when.toLocaleString()}.

Open Covrily to review and decide: return or keep.`;

      await sendMail(to, subject, body);

      // stamp last_notified_at to avoid re-sends
      await supabase
        .from("deadlines")
        .update({ last_notified_at: new Date().toISOString() })
        .eq("id", d.id);
    }
  };

  if (dueToday.error || weekAhead.error) {
    return res.status(500).json({ ok: false, error: dueToday.error || weekAhead.error });
  }

  await sendFor(dueToday.data ?? [], "today");
  await sendFor(weekAhead.data ?? [], "week");

  return res.status(200).json({
    ok: true,
    sent_today: dueToday.data?.length ?? 0,
    sent_week_ahead: weekAhead.data?.length ?? 0
  });
}
