// api/amazon/orders.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabase-admin.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = (req.query.user as string) || "";
    if (!user) return res.status(400).json({ ok: false, error: "missing user" });

    const { data, error } = await supabaseAdmin
      .from("amazon_orders")
      .select(
        "order_id, order_date, order_url, invoice_url, pdf_url, total_amount, product_name_short"
      )
      .eq("user_id", user)
      .order("order_date", { ascending: false });

    if (error) return res.status(400).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, orders: data || [] });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
