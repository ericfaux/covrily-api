// api/admin/parse-stats.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_TOKEN  = process.env.ADMIN_TOKEN || "";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = (req.headers["x-admin-token"] as string) || (req.query.token as string) || "";
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from("parse_logs")
    .select("merchant, order_id_found, purchase_date_found, total_cents_found");

  if (error) return res.status(500).json({ ok: false, error: error.message });

  const stats: Record<string, { total: number; failures: number }> = {};

  for (const row of data || []) {
    const m = (row.merchant || "unknown").toLowerCase();
    if (!stats[m]) stats[m] = { total: 0, failures: 0 };
    stats[m].total++;
    const success = row.order_id_found && row.purchase_date_found && row.total_cents_found;
    if (!success) stats[m].failures++;
  }

  const result = Object.entries(stats).map(([merchant, { total, failures }]) => ({
    merchant,
    total,
    failures,
    failure_rate: total ? failures / total : 0
  }));

  return res.status(200).json({ ok: true, stats: result });
}

