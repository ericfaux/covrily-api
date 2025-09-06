import { createClient } from "@supabase/supabase-js";

const FROM = process.env.NOTIFY_FROM_EMAIL || "no-reply@covrily.com";
const TO   = process.env.NOTIFY_TO_EMAIL   || "eric.faux@covrily.com";
const POSTMARK_TOKEN = process.env.POSTMARK_SERVER_TOKEN!;

function startOfUTC(d = new Date()) { const x = new Date(d); x.setUTCHours(0,0,0,0); return x; }
function addDaysUTC(d: Date, n: number) { const x = new Date(d); x.setUTCDate(x.getUTCDate()+n); return x; }

async function send(subject: string, text: string) {
  await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "X-Postmark-Server-Token": POSTMARK_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ From: FROM, To: TO, Subject: subject, TextBody: text, MessageStream: "outbound" }),
  });
}

export default async function handler(req: any, res: any) {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const start = startOfUTC();
  const end   = addDaysUTC(start, 1);

  // Only deadlines due TODAY (no overdue), and not yet day-of notified
  const { data: due } = await supabase
    .from("deadlines")
    .select("id, receipt_id, due_at")
    .eq("status", "open")
    .gte("due_at", start.toISOString())
    .lt("due_at",  end.toISOString())
    .is("last_notified_at", null);

  if (!due?.length) return res.status(200).json({ ok: true, processed: 0 });

  // Pull receipt details
  const ids = due.map(d => d.receipt_id);
  const { data: receipts } = await supabase
    .from("receipts")
    .select("id, merchant, purchase_date, total_cents")
    .in("id", ids);

  const recById = new Map((receipts||[]).map(r => [r.id, r]));
  let sent = 0;

  for (const d of due) {
    const r = recById.get(d.receipt_id);
    const amount = r?.total_cents ? `$${(r.total_cents/100).toFixed(2)}` : "";
    const subj = `Reminder: ${r?.merchant || "purchase"} return window ends today`;
    const body =
`Heads up!

Your ${r?.merchant ?? "purchase"} from ${r?.purchase_date ?? "unknown"} (${amount}) is approaching the return deadline.
Deadline: ${new Date(d.due_at).toLocaleString()}.

Open Covrily to review and decide: return or keep.`;

    await send(subj, body);
    await supabase.from("deadlines").update({ last_notified_at: new Date().toISOString() }).eq("id", d.id);
    sent++;
  }

  return res.status(200).json({ ok: true, processed: sent });
}
