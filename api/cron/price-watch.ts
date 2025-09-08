// api/cron/price-watch.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { extractPriceCentsFromHtml } from "../../lib/price-parsers";
import { previewDecision } from "../../lib/decision-engine";
import { sendMail } from "../../lib/mail";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const MAX_FETCH = parseInt(process.env.PRICE_WATCH_MAX_FETCH || "10", 10);
const FALLBACK = process.env.NOTIFY_TO || "";
const USE_FALLBACK = process.env.USE_NOTIFY_TO_FALLBACK === "true";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const onlyReceipt = (req.query.receipt_id as string) || null;
    const mockPrice = req.query.mock_price ? parseInt(String(req.query.mock_price), 10) : null; // cents
    const dryRun = (req.query.dry as string) === "1";

    let q = sb.from("product_links").select("receipt_id, url, selector, last_notified_at, active").eq("active", true);
    if (onlyReceipt) q = q.eq("receipt_id", onlyReceipt);
    q = q.limit(Math.max(1, Math.min(MAX_FETCH, 25)));

    const { data: links, error: e0 } = await q;
    if (e0) throw e0;

    let processed = 0, emailed = 0, observations = 0;
    let noLink = 0, noPrice = 0, notInWindow = 0, gated24h = 0, noRecipient = 0;

    for (const l of links ?? []) {
      processed++;

      const { data: rec } = await sb.from("receipts")
        .select("id, user_id, merchant, order_id, purchase_date, total_cents")
        .eq("id", l.receipt_id).single();
      if (!rec) { noLink++; continue; }

      // Resolve current price
      let current_cents: number | null = null;
      let source = "fetch";
      let excerpt: string | null = null;

      if (mockPrice != null) {
        current_cents = mockPrice;
        source = "mock";
      } else {
        const r = await fetch(l.url, { method: "GET", headers: { "User-Agent": "CovrilyPriceWatch/1.0" } }).catch(() => null);
        const html = r && r.ok ? await r.text() : "";
        const parsed = extractPriceCentsFromHtml(l.url, html, l.selector);
        current_cents = parsed.cents;
        excerpt = parsed.excerpt ?? null;
      }

      if (current_cents == null) { noPrice++; continue; }

      // Log observation
      await sb.from("price_observations").insert([{
        receipt_id: l.receipt_id, observed_price_cents: current_cents, source, raw_excerpt: excerpt ?? null
      }]);
      observations++;

      // Decide
      const preview = previewDecision(
        { merchant: rec.merchant, purchase_date: rec.purchase_date, total_cents: rec.total_cents },
        new Date(),
        { current_price_cents: current_cents }
      );

      const within24hGate = l.last_notified_at && (Date.now() - new Date(l.last_notified_at).getTime()) < 24*60*60*1000;
      if (within24hGate) { gated24h++; continue; }
      if (preview.suggestion !== "price_adjust") { notInWindow++; continue; }

      // Resolve recipient
      const { data: prof } = await sb.from("profiles").select("email").eq("id", rec.user_id).single();
      const to = prof?.email || (USE_FALLBACK ? FALLBACK : "");
      if (!to) { noRecipient++; continue; }

      if (!dryRun) {
        const diff = preview.totals.savings_cents ? `$${(preview.totals.savings_cents/100).toFixed(2)}` : "";
        const subject = `Price drop found for ${rec.merchant ?? "your purchase"}`;
        const text =
`Good news!

We found a potential price drop on your ${rec.merchant ?? "purchase"} (order ${rec.order_id ?? ""}).
Original: $${(rec.total_cents/100).toFixed(2)}
Current:  $${(current_cents/100).toFixed(2)}
Potential savings: ${diff}

Price-adjust window ends (UTC): ${preview.windows.price_adjust_end_at ?? "unknown"}

Next steps:
1) Visit the merchant order page.
2) Request a price adjustment referencing your order number.`;
        await sendMail(to, subject, text, { debugRouteTo: prof?.email || null });
        await sb.from("product_links").update({ last_notified_at: new Date().toISOString() }).eq("receipt_id", rec.id);
      }
      emailed++;
    }

    return res.status(200).json({
      ok: true, processed, observations, emailed, dryRun: dryRun || false, mock: mockPrice ?? null,
      reasons: { noLink, noPrice, notInWindow, gated24h, noRecipient }
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
