// api/admin/recent.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_TOKEN  = process.env.ADMIN_TOKEN || "";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Admin auth
  const token = (req.headers["x-admin-token"] as string) || (req.query.token as string) || "";
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const qRaw = (req.query.q as string) || "";
  const q = qRaw.trim();
  const limit = Math.min(parseInt(String(req.query.limit || "12"), 10) || 12, 50);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Base query
  let query = sb
    .from("receipts")
    .select("id, merchant, order_id, purchase_date, total_cents")
    .order("purchase_date", { ascending: false })
    .limit(limit);

  // Search by merchant or order_id (case-insensitive)
  if (q) query = query.or(`merchant.ilike.%${q}%,order_id.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ ok: false, error: error.message });

  // Attach first product link (if any) for convenience
  const ids = (data || []).map((r) => r.id);
  const linksByReceipt: Record<string, any> = {};
  if (ids.length) {
    const { data: links } = await sb
      .from("product_links")
      .select("receipt_id, url, merchant_hint, active")
      .in("receipt_id", ids);
    (links || []).forEach((l) => {
      if (!linksByReceipt[l.receipt_id]) linksByReceipt[l.receipt_id] = l;
    });
  }

  return res.status(200).json({
    ok: true,
    items: (data || []).map((r) => ({
      ...r,
      link: linksByReceipt[r.id] || null,
    })),
  });
}
