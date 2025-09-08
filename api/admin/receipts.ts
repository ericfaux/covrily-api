// api/admin/receipts.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const ALLOW_QUERY_TOKEN = process.env.ALLOW_QUERY_TOKEN === "true";

function authed(req: VercelRequest): boolean {
  const headerOK = req.headers["x-admin-token"] === ADMIN_TOKEN && !!ADMIN_TOKEN;
  const queryOK = ALLOW_QUERY_TOKEN && typeof req.query.token === "string" && req.query.token === ADMIN_TOKEN;
  return headerOK || queryOK;
}

/**
 * GET /api/admin/receipts?limit=25&days=90&q=bestbuy
 * Returns latest receipts (id, merchant, order_id, total_cents, purchase_date).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authed(req)) return res.status(404).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }

  try {
    const limit = Math.max(1, Math.min(parseInt(String(req.query.limit ?? "25"), 10) || 25, 100));
    const days = Math.max(1, Math.min(parseInt(String(req.query.days ?? "365"), 10) || 365, 3650));
    const q = (req.query.q as string | undefined)?.trim().toLowerCase();

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    let select = sb
      .from("receipts")
      .select("id, merchant, order_id, total_cents, purchase_date")
      .gte("purchase_date", since)
      .order("purchase_date", { ascending: false })
      .limit(limit);

    // optional simple search
    if (q && q.length > 1) {
      // merchant ilike OR order_id ilike
      select = select.ilike("merchant", `%${q}%`).or(`order_id.ilike.%${q}%`);
    }

    const { data, error } = await select;
    if (error) return res.status(500).json({ ok: false, error: error.message });

    return res.status(200).json({ ok: true, receipts: data ?? [] });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
