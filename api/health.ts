// /api/health.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

function tokenOK(req: VercelRequest): boolean {
  const header = (req.headers["x-admin-token"] as string) || "";
  const query = (req.query.token as string) || "";
  const t = header || query || "";
  return !!t && t === (process.env.ADMIN_TOKEN || "");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!tokenOK(req)) return res.status(404).end(); // hide the route unless authorized
  return res.status(200).json({ ok: true, ts: new Date().toISOString() });
}
