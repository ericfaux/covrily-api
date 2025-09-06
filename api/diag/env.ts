// api/diag/env.ts
import type { VercelRequest, VercelResponse } from "vercel";
import { createClient } from "@supabase/supabase-js";
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers["x-admin-token"] !== process.env.ADMIN_TOKEN) return res.status(404).end();
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const sb = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  let dbOk = false, counts: any = null;
  if (sb) {
    const { count, error } = await sb.from("deadlines").select("id", { head: true, count: "exact" });
    if (!error) { dbOk = true; counts = { deadlines: count }; }
  }
  return res.status(200).json({
    ok: true,
    envs_present: {
      POSTMARK_TOKEN: !!process.env.POSTMARK_TOKEN,
      POSTMARK_FROM: !!process.env.POSTMARK_FROM,
      NOTIFY_TO: !!process.env.NOTIFY_TO,
      SUPABASE_URL: !!url,
      SUPABASE_SERVICE_ROLE_KEY: !!key
    },
    dbOk, counts
  });
}
