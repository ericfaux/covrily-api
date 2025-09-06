import { createClient } from "@supabase/supabase-js";

const FROM = process.env.NOTIFY_FROM_EMAIL || "no-reply@covrily.com";
const TO   = process.env.NOTIFY_TO_EMAIL   || "eric.faux@covrily.com";
const POSTMARK_SERVER_TOKEN = process.env.POSTMARK_SERVER_TOKEN!;

function startOfUTC(d = new Date()) { const x = new Date(d); x.setUTCHours(0,0,0,0); return x; }
function addDaysUTC(d: Date, n: number) { const x = new Date(d); x.setUTCDate(x.getUTCDate()+n); return x; }

async function send(subject: string, text: string) {
  await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "X-Postmark-Server-Token": POSTMARK_SERVER_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ From: FROM, To: TO, Subject: subject, TextBody: text, MessageStream: "outbound" }),
  });
}

export default async function handler(_req: any, res: any) {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const day7start = startOfUTC(addDaysUTC(new Date(), 7));
  const day7end   = addDaysUTC(day7start, 1);

  const { data: due, error } = await supabase
    .from("deadlines")
    .select("id, receipt_id, due_at")
    .eq("status", "open")
    .gte("due_at", day7start.toISOString())
    .lt("due_at",  day7end.toISOString())
    .is("heads_up_notified_at", null);

  if (error) return res.status(500).json({ ok: false, error });
  if (!due?.length) return res.status(200).json({ ok: true, processed: 0 });

  const ids = due.map(d => d.receipt_id);
  const { data: receipts } = await supabase
    .from("receipts")
    .select("id, merchant, purchase_date, total_cents")
    .in("id", ids);

  const recById = new Map((receipts || []).map(r => [r.id, r]));
  let sent = 0;

  for (const d of due) {
    const r = recById.get(d.receipt_id);
    const amount = r?.total_cents ? `$${(r.total_cents/100).toFixed(2)}` : "";
    const subject = `Heads-up: ${r?.merchant || "purchase"} return deadline in 7 days`;
    const body = `Friendly reminder!

Your ${r?.merchant ?? "purchase"} from ${r?.purchase_date ?? "unknown"} (${amount}) has a return deadline on ${new Date(d.due_at).toLocaleString()} (in 7 days).

Open Covrily to review and decide: return or keep.`;

    await send(subject, body);
    await supabase.from("deadlines").update({ heads_up_notified_at: new Date().toISOString() }).eq("id", d.id);
    sent++;
  }

  return res.status(200).json({ ok: true, processed: sent });
}
