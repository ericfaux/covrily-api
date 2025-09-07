// api/price-check.ts
import type { VercelRequest, VercelResponse } from "vercel";
import { createClient } from "@supabase/supabase-js";
import { previewDecision } from "../lib/decision-engine";
import { sendMail } from "../lib/mail";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const FALLBACK = process.env.NOTIFY_TO || "";
const USE_FALLBACK = process.env.USE_NOTIFY_TO_FALLBACK === "true";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!ADMIN_TOKEN || req.headers["x-admin-token"] !== ADMIN_TOKEN) return res.status(404).end();
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).end(); }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const receipt_id = body?.receipt_id as string;
    const current_price_cents = typeof body?.current_price_cents === "number"
      ? body.current_price_cents
      : (typeof body?.current_price === "number" ? Math.round(body.current_price * 100) : null);
    const send = body?.send === true;

    if (!receipt_id) return res.status(400).json({ ok: false, error: "receipt_id required" });
    if (current_price_cents == null) return res.status(400).json({ ok: false, error: "current_price or current_price_cents required" });

    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: rec, error } = await supabase
      .from("receipts")
      .select("id, user_id, merchant, order_id, purchase_date, total_cents")
      .eq("id", receipt_id)
      .single();

    if (error || !rec) return res.status(404).json({ ok: false, error: "receipt not found" });

    const preview = previewDecision(
      { merchant: rec.merchant, purchase_date: rec.purchase_date, total_cents: rec.total_cents },
      new Date(),
      { current_price_cents }
    );

    let sent = false;
    let to: string | null = null;

    if (send) {
      // resolve user email
      const { data: prof } = await supabase.from("profiles").select("email").eq("id", rec.user_id).single();
      to = prof?.email ?? (USE_FALLBACK ? FALLBACK : null);

      if (to) {
        const subject = `Price drop found for ${rec.merchant ?? "your purchase"}`;
        const diff = preview.totals.savings_cents ? `$${(preview.totals.savings_cents / 100).toFixed(2)}` : "";
        const deadline = preview.windows.price_adjust_end_at ?? "unknown";

        const text =
`Good news!

We see a potential price drop on your ${rec.merchant ?? "purchase"} (order ${rec.order_id ?? ""}).
Original: $${(rec.total_cents/100).toFixed(2)}
Current:  $${(current_price_cents/100).toFixed(2)}
Potential savings: ${diff}

Price-adjust window ends (UTC): ${deadline}

Next steps:
1) Visit the merchant order page.
2) Request a price adjustment referencing your order number.

If you proceed, please reply and we’ll log this decision.`;

        await sendMail(to, subject, text, { debugRouteTo: prof?.email || null });
        sent = true;
      }
    }

    return res.status(200).json({ ok: true, receipt_id, preview, email: { attempted: send, sent, to } });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
}
