// api/cron/heads-up.ts
import type { VercelRequest, VercelResponse } from "vercel";
import { createClient } from "@supabase/supabase-js";
import { sendMail } from "../../lib/mail";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const to  = process.env.NOTIFY_TO!; // demo recipient for now

function startOfUTC(d = new Date()) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
function addDaysUTC(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    if (!url || !key) throw new Error("Supabase env not set");
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    // 7 full days from now (UTC day boundary)
    const day7start = startOfUTC(addDaysUTC(new Date(), 7)).toISOString();
    const day8start = startOfUTC(addDaysUTC(new Date(), 8)).toISOString();

    const { data, error } = await supabase
      .from("deadlines")
      .select(`
        id, receipt_id, due_at, status, heads_up_notified_at,
        receipts:receipt_id (merchant, purchase_date, total_cents)
      `)
      .eq("status", "open")
      .gte("due_at", day7start)
      .lt("due_at", day8start)
      .is("heads_up_notified_at", null);

    if (error) throw error;

    let sent = 0;
    for (const d of (data ?? [])) {
      const r = (d as any).receipts || {};
      const when = new Date((d as any).due_at);
      const amount = r.total_cents ? `$${(r.total_cents/100).toFixed(2)}` : "";

      const subject = `Heads-up: ${(r.merchant || "purchase")} return deadline in 7 days`;
      const body =
`Friendly reminder!

Your ${r.merchant ?? "purchase"} from ${r.purchase_date ?? "unknown"} (${amount})
has a return deadline on ${when.toISOString().replace("T", " ").replace(".000Z","Z")} (in ~7 days).

Open Covrily to review and decide: return or keep.`;

      await sendMail(to, subject, body);

      await supabase
        .from("deadlines")
        .update({ heads_up_notified_at: new Date().toISOString() })
        .eq("id", (d as any).id);

      sent++;
    }

    return res.status(200).json({ ok: true, processed: sent });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
