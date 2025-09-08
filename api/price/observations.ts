// api/price/observations.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL!; const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ""; const ALLOW_QUERY_TOKEN = process.env.ALLOW_QUERY_TOKEN === "true";

function authed(req: VercelRequest) {
  const headerOK = req.headers["x-admin-token"] === ADMIN_TOKEN && !!ADMIN_TOKEN;
  const queryOK = ALLOW_QUERY_TOKEN && typeof req.query.token === "string" && req.query.token === ADMIN_TOKEN;
  return headerOK || queryOK;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authed(req)) return res.status(404).end();
  const rid = (req.query.receipt_id as string) || "";
  if (!rid) return res.status(400).json({ ok: false, error: "receipt_id required" });

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb
    .from("price_observations")
    .select("id, observed_price_cents, source, created_at, raw_excerpt")
    .eq("receipt_id", rid)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, observations: data });
}
