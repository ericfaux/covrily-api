// @ts-nocheck
// api/receipts/index.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

export const config = { runtime: "nodejs" };

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_TOKEN  = process.env.ADMIN_TOKEN || "";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  // very light auth (same style as your Admin UI)
  const token = (req.query.token as string) || "";
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: "bad token" });
  }

  const id = (req.query.id as string) || "";
  if (!id) return res.status(400).json({ ok: false, error: "missing id" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  const { data, error } = await supabase
    .from("receipts")
    .select("id,user_id,merchant,order_id,purchase_date,total_cents,tax_cents,shipping_cents,currency,raw_url")
    .eq("id", id)
    .maybeSingle();

  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (!data) return res.status(404).json({ ok: false, error: "not found" });

  return res.status(200).json({ ok: true, receipt: data });
}
