// api/admin/gmail-token.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = (req.headers["x-admin-token"] as string) || (req.query.token as string) || "";
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const user = (req.query.user as string) || "";
  if (!user) return res.status(400).json({ ok: false, error: "missing user" });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from("gmail_tokens")
    .select("user_id")
    .eq("user_id", user)
    .maybeSingle();
  if (error) return res.status(500).json({ ok: false, error: error.message });

  return res.status(200).json({ ok: true, exists: !!data });
}
