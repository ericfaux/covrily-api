// api/diag/env.ts
import type { VercelRequest, VercelResponse } from "vercel";
import { createClient } from "@supabase/supabase-js";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const url = process.env.SUPABASE_URL || "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const pmTok = !!process.env.POSTMARK_TOKEN;
    const pmFrom = !!process.env.POSTMARK_FROM;
    const to = !!process.env.NOTIFY_TO;

    let dbOk = false;
    let counts: any = null;

    if (url && key) {
      const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { count, error } = await sb.from("deadlines").select("id", { count: "exact", head: true });
      if (!error) { dbOk = true; counts = { deadlines: count }; }
    }

    return res.status(200).json({
      ok: true,
      envs_present: { POSTMARK_TOKEN: pmTok, POSTMARK_FROM: pmFrom, NOTIFY_TO: to, SUPABASE_URL: !!url, SUPABASE_SERVICE_ROLE_KEY: !!key },
      dbOk,
      counts
    });
  } catch (e: any) {
    console.error("diag/env error", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
