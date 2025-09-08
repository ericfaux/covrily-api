// @ts-nocheck
// api/cron/due-today.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { sendMail } from "../../lib/mail";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const fallbackTo = process.env.NOTIFY_TO || "";
const useFallback = process.env.USE_NOTIFY_TO_FALLBACK === "true";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    if (!url || !key) throw new Error("Supabase env not set");
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const todayGate = new Date(now.getTime() - 18 * 60 * 60 * 1000).toISOString();

    type Row = {
      id: string;
      due_at: string;
      receipt_id: string | null;
      receipts: {
        user_id: string | null;
        merchant: string | null;
        order_id: string | null;
        purchase_date: string | null;
        total_cents: number | null;
      } | null;
    };

    // 1) Find due-today deadlines
    const { data, error } = await supabase
      .from("deadlines")
      .select(`
        id, due_at, status, last_notified_at, receipt_id,
        receipts:receipt_id ( user_id, merchant, order_id, purchase_date, total_cents )
      `)
      .eq("status", "open")
      .gte("due_at", now.toISOString())
      .lt("due_at", in24h.toISOString())
      .or(`last_notified_at.is.null,last_notified_at.lt.${todayGate}`);

    if (error) throw error;

    // 2) Resolve emails for the unique user_ids
    const userIds = Array.from(new Set((data ?? [])
      .map(r => (r as any).receipts?.user_id)
      .filter((x): x is string => !!x)));

    const emails = new Map<string, string | null>();
    if (userIds.length) {
      const { data: profs, error: e2 } = await supabase
        .from("profiles")
        .select("id, email")
        .in("id", userIds);
      if (e2) throw e2;
      for (const p of (profs ?? [])) emails.set((p as any).id, (p as any).email);
    }

    // 3) Send
    let sent = 0;
    for (const d of (data ?? []) as Row[]) {
      const r = d.receipts ?? ({} as Row["receipts"]);
      const userId = r?.user_id ?? null;
      const email = userId ? emails.get(userId) ?? null : null;

      // if no profile email, optionally fall back to NOTIFY_TO
      const to = email || (useFallback ? fallbackTo : "");
      if (!to) {
        // mark as "checked" to avoid re-spam, then continue
        await supabase.from("deadlines").update({ last_notified_at: new Date().toISOString() }).eq("id", d.id);
        continue;
      }

      const when = new Date(d.due_at);
      const amount = typeof r?.total_cents === "number" ? `$${(r!.total_cents!/100).toFixed(2)}` : "";

      const subject = `Reminder: ${(r?.merchant ?? "your purchase")} return window ends ${when.toISOString().replace("T"," ").replace(".000Z","Z")}`;
      const body =
`Heads up!

Your ${r?.merchant ?? "purchase"} from ${r?.purchase_date ?? "unknown"} ${amount ? `(${amount})` : ""}
is approaching the return deadline.
Deadline (UTC): ${when.toISOString().replace("T"," ").replace(".000Z","Z")}

Open Covrily to review and decide: return or keep.`;

      await sendMail(to, subject, body, { debugRouteTo: email || null });

      await supabase
        .from("deadlines")
        .update({ last_notified_at: new Date().toISOString() })
        .eq("id", d.id);

      sent++;
    }

    return res.status(200).json({ ok: true, sent_today: sent, users_resolved: userIds.length });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
