// api/cron/heads-up.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { sendMail } from "../../lib/mail";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const fallbackTo = process.env.NOTIFY_TO || "";
const useFallback = process.env.USE_NOTIFY_TO_FALLBACK === "true";

function startOfUTC(d = new Date()) { const x = new Date(d); x.setUTCHours(0,0,0,0); return x; }
function addDaysUTC(d: Date, n: number) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    if (!url || !key) throw new Error("Supabase env not set");
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const day7start = startOfUTC(addDaysUTC(new Date(), 7)).toISOString();
    const day8start = startOfUTC(addDaysUTC(new Date(), 8)).toISOString();

    type Row = {
      id: string;
      due_at: string;
      receipt_id: string | null;
      receipts: { user_id: string | null; merchant: string | null; purchase_date: string | null; total_cents: number | null } | null;
    };

    const { data, error } = await supabase
      .from("deadlines")
      .select(`
        id, due_at, status, heads_up_notified_at, receipt_id,
        receipts:receipt_id ( user_id, merchant, purchase_date, total_cents )
      `)
      .eq("status", "open")
      .gte("due_at", day7start)
      .lt("due_at", day8start)
      .is("heads_up_notified_at", null);

    if (error) throw error;

    // resolve emails
    const userIds = Array.from(new Set((data ?? [])
      .map(r => (r as any).receipts?.user_id)
      .filter((x): x is string => !!x)));
    const emails = new Map<string, string | null>();
    if (userIds.length) {
      const { data: profs, error: e2 } = await supabase.from("profiles").select("id, email").in("id", userIds);
      if (e2) throw e2;
      for (const p of (profs ?? [])) emails.set((p as any).id, (p as any).email);
    }

    let sent = 0;
    for (const d of (data ?? []) as Row[]) {
      const r = d.receipts ?? ({} as Row["receipts"]);
      const userId = r?.user_id ?? null;
      const email = userId ? emails.get(userId) ?? null : null;

      const to = email || (useFallback ? fallbackTo : "");
      if (!to) {
        await supabase.from("deadlines").update({ heads_up_notified_at: new Date().toISOString() }).eq("id", d.id);
        continue;
      }

      const when = new Date(d.due_at);
      const amount = typeof r?.total_cents === "number" ? `$${(r!.total_cents!/100).toFixed(2)}` : "";

      const subject = `Heads-up: ${(r?.merchant || "purchase")} return deadline in ~7 days`;
      const body =
`Friendly reminder!

Your ${r?.merchant ?? "purchase"} from ${r?.purchase_date ?? "unknown"} ${amount ? `(${amount})` : ""}
has a return deadline on ${when.toISOString().replace("T"," ").replace(".000Z","Z")} (in ~7 days).

Open Covrily to review and decide: return or keep.`;

      await sendMail(to, subject, body, { debugRouteTo: email || null });

      await supabase
        .from("deadlines")
        .update({ heads_up_notified_at: new Date().toISOString() })
        .eq("id", d.id);

      sent++;
    }

    return res.status(200).json({ ok: true, processed: sent, users_resolved: userIds.length });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
