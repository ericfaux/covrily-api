// api/health.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers["x-admin-token"] !== process.env.ADMIN_TOKEN) return res.status(404).end();
  return res.status(200).json({ ok: true, ts: new Date().toISOString() });
}
