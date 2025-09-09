// /api/health.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Accept token from header OR query string for convenience in the admin UI
  const token =
    (req.headers["x-admin-token"] as string | undefined) ||
    (req.query.token as string | undefined);

  if (!token || token !== process.env.ADMIN_TOKEN) {
    // Hide this endpoint unless the token matches
    return res.status(404).end();
  }

  return res.status(200).json({ ok: true, ts: new Date().toISOString() });
}
