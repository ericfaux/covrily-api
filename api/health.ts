// api/health.ts
import type { VercelRequest, VercelResponse } from "vercel";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  return res.status(200).json({
    ok: true,
    ts: new Date().toISOString(),
    node: process.version,
    envs_present: {
      POSTMARK_TOKEN: !!process.env.POSTMARK_TOKEN,
      POSTMARK_FROM: !!process.env.POSTMARK_FROM,
      NOTIFY_TO: !!process.env.NOTIFY_TO,
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY
    }
  });
}
