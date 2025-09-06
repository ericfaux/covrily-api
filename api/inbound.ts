// api/inbound.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import supabaseAdmin from "../lib/supabase-admin";
import { naiveParse } from "../lib/parse";
import { computeReturnDeadline } from "../lib/policies";

function toDateIso(d: string | null | undefined): string | null {
  if (!d) return null;
  // allow "YYYY-MM-DD" or human dates; store as ISO if possible
  const dt = new Date(d);
  return isNaN(+dt) ? null : dt.toISOString().slice(0, 10); // only date portion
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // health check + Postmark "Check" button
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true, info: "inbound webhook ready" });
  }

  // Postmark inbound JSON
  const body = typeof req.body === "object" ? req.body : JSON.parse(req.body ?? "{}");

  // We use MailboxHash to carry the user_id (Postmark: Settings → “Enable MailboxHash”)
  const userId = (body?.MailboxHash || "").trim();
  if (!userId) {
    // Always 200 for Postmark to avoid retries, but explain why ignored
    return res.status(200).json({ ok: true, ignored: "missing MailboxHash (user_id)" });
  }

  // Prefer TextBody; fall back to HtmlBody stripped
  const text: string = body?.TextBody || body?.HtmlBody || "";

  // Parse a few fields (merchant, order_id, purchase_date, total_cents)
  const parsed = naiveParse(text, body?.FromFull?.Email ?? "");

  // 🔒 Normalize for our unique key
  const merchant = (parsed.merchant || (body?.FromFull?.Email?.split("@")[1] ?? "")).toLowerCase();
  const orderId = parsed.order_id || ""; // NEVER null
  const purchaseDate = toDateIso(parsed.purchase_date); // "YYYY-MM-DD" or null
  const totalCents = parsed.total_cents ?? null;

  // --- UPSERT RECEIPT (unique: user_id, merchant, order_id, purchase_date)
  const { data: receiptRows, error: upsertErr } = await supabaseAdmin
    .from("receipts")
    .upsert(
      [
        {
          user_id: userId,
          merchant,
          order_id: orderId,
          purchase_date: purchaseDate,
          total_cents: totalCents,
        },
      ],
      { onConflict: "user_id,merchant,order_id,purchase_date" }
    )
    .select("id")
    .limit(1);

  if (upsertErr) {
    // Return 500 so we see it in Vercel logs, but Postmark will retry; that's ok
    return res.status(500).json({ ok: false, where: "receipts.upsert", error: upsertErr });
  }

  const receiptId = receiptRows?.[0]?.id;
  if (!receiptId) {
    return res.status(200).json({ ok: true, info: "upserted, no id selected" });
  }

// --- UPSERT RETURN DEADLINE (unique: receipt_id, type)
const due = computeReturnDeadline(merchant, purchaseDate || "");
if (due) {
  const { error: dErr } = await supabaseAdmin
    .from("deadlines")
    .upsert(
      [
        {
          receipt_id: receiptId,
          type: "return",
          status: "open",
          due_at: due.toISOString(),
        },
      ],
      { onConflict: "receipt_id,type" }
    );

  if (dErr) {
    console.error("deadlines.upsert error:", dErr);
    return res.status(500).json({ ok: false, where: "deadlines.upsert", error: dErr });
  }
}
