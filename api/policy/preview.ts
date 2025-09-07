// api/policy/preview.ts
import type { VercelRequest, VercelResponse } from "vercel";
import { createClient } from "@supabase/supabase-js";
import { previewDecision } from "../../lib/decision-engine";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const id = (req.query.id as string) || (req.query.receipt_id as string);
    if (!id) return res.status(400).json({ ok: false, error: "id (receipt_id) required" });

    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supabase
      .from("receipts")
      .select("id, merchant, purchase_date, total_cents")
      .eq("id", id)
      .single();

    if (error || !data) return res.status(404).json({ ok: false, error: "receipt not found" });

    // current price can be provided as ?current_price_cents=12345 OR ?current_price=123.45
    const currentPriceCentsQ = req.query.current_price_cents as string | undefined;
    const currentPriceDollarsQ = req.query.current_price as string | undefined;
    const current_price_cents =
      currentPriceCentsQ != null
        ? parseInt(currentPriceCentsQ, 10)
        : currentPriceDollarsQ != null
        ? Math.round(parseFloat(currentPriceDollarsQ) * 100)
        : null;

    const preview = previewDecision(
      {
        merchant: (data as any).merchant,
        purchase_date: (data as any).purchase_date,
        total_cents: (data as any).total_cents,
      },
      new Date(),
      { current_price_cents }
    );

    return res.status(200).json({ ok: true, receipt_id: id, preview });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
