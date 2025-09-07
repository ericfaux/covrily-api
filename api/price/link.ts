// api/price/link.ts
import type { VercelRequest, VercelResponse } from "vercel";
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authed(req)) return res.status(404).end();
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const rid = (req.query.receipt_id as string) || (req.body && (req.body.receipt_id as string)) || "";
  if (!rid) return res.status(400).json({ ok: false, error: "receipt_id required" });

  if (req.method === "GET") {
    const { data } = await sb.from("product_links").select("*").eq("receipt_id", rid).maybeSingle();
    return res.status(200).json({ ok: true, link: data || null });
  }

  if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { url: linkUrl, selector, merchant_hint, active } = body;
    if (!linkUrl) return res.status(400).json({ ok: false, error: "url required" });

    const { data, error } = await sb
      .from("product_links")
      .upsert({ receipt_id: rid, url: linkUrl, selector: selector ?? null, merchant_hint: merchant_hint ?? null, active: active ?? true })
      .select()
      .single();

    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, link: data });
  }

  res.setHeader("Allow", "GET,POST");
  return res.status(405).end();
}
