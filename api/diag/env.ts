// /api/diag/env.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Accept token from header OR query string
  const token =
    (req.headers["x-admin-token"] as string | undefined) ||
    (req.query.token as string | undefined);

  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(404).end();
  }

  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  // Create a service client only if we have both pieces
  const sb =
    url && key
      ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
      : null;

  // Optional quick DB health check (count deadlines table head-only)
  let dbok = false;
  let counts: { deadlines?: number } = {};

  if (sb) {
    const { count, error } = await sb.from("deadlines").select("id", {
      count: "exact",
      head: true,
    });
    if (!error) {
      dbok = true;
      counts.deadlines = count ?? 0;
    }
  }

  return res.status(200).json({
    ok: true,
    present: {
      POSTMARK_TOKEN: !!process.env.POSTMARK_TOKEN,
      POSTMARK_FROM: !!process.env.POSTMARK_FROM,
      NOTIFY_TO: !!process.env.NOTIFY_TO,
      SUPABASE_URL: !!url,
      SUPABASE_SERVICE_ROLE_KEY: !!key,
    },
    dbok,
    counts,
  });
}
