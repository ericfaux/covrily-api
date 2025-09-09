// /api/diag/env.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

function tokenOK(req: VercelRequest): boolean {
  const header = (req.headers["x-admin-token"] as string) || "";
  const query = (req.query.token as string) || "";
  const t = header || query || "";
  return !!t && t === (process.env.ADMIN_TOKEN || "");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!tokenOK(req)) return res.status(404).end(); // hide unless authorized

  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const sb = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

  let dbok = false;
  let counts: any = null;

  if (sb) {
    try {
      // lightweight count of deadlines table just to confirm DB connectivity
      const { count, error } = await sb.from("deadlines").select("id", { head: true, count: "exact" });
      if (!error) {
        dbok = true;
        counts = { deadlines: count ?? 0 };
      }
    } catch {
      dbok = false;
    }
  }

  return res.status(200).json({
    ok: true,
    envs_present: {
      POSTMARK_TOKEN: !!process.env.POSTMARK_TOKEN,
      POSTMARK_FROM: !!process.env.POSTMARK_FROM,
      NOTIFY_TO: !!process.env.NOTIFY_TO,
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    dbok,
    counts,
  });
}
