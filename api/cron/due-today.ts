// api/cron/due-today.ts
import type { VercelRequest, VercelResponse } from "vercel";
import { createClient } from "@supabase/supabase-js";
import { sendMail } from "../../lib/mail"; // <-- correct relative path

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const to  = process.env.NOTIFY_TO!; // demo recipient for now

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    if (!url || !key) throw new Error("Supabase env not set");
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    // UTC clock (Vercel is UTC by default)
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Gate re-sends: don't notify if we already mailed in the last 18h
    const todayGate = new Date(now.getTime() - 18 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("deadlines")
      .select(`
        id, due_at, status, receipt_id,
        receipts:receipt_id (merchant, order_id, purchase_date, total_cents)
      `)
      .eq("status", "open")
      .gte("due_at", now.toISOString())
      .lt("due_at", in24h.toISOString())
      .or(`last_notified_at.is.null,last_notified_at.lt.${todayGate}`);

    if (error) throw error;

    let sent = 0;
    for (const d of (data ?? [])) {
      const r = (d as any).receipts || {};
      const when = new Date((d as any).due_at);

      const subject = `Reminder: ${(r.merchant ?? "your purchase")} return window ends ${when.toISOString().replace("T", " ").replace(".000Z","Z")}`;
      const body =
`Heads up!

Your ${r.merchant ?? "purchase"} from ${r.purchase_date ?? "unknown"} (${r.total_cents ? `$${(r.total_cents/100).toFixed(2)}` : ""})
is approaching the return deadline.
Deadline (UTC): ${when.toISOString().replace("T", " ").replace(".000Z","Z")}

Open Covrily to review and decide: return or keep.`;

      await sendMail(to, subject, body);

      await supabase
        .from("deadlines")
        .update({ last_notified_at: new Date().toISOString() })
        .eq("id", (d as any).id);

      sent++;
    }

    return res.status(200).json({ ok: true, sent_today: sent });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
