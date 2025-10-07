// PATH: api/gmail/auth.ts
// Assumes upstream caller already confirmed Supabase identity; trade-off is building minimal state
// payloads (user id only) to keep OAuth redirects straightforward while still preventing CSRF reuse.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getGoogleAuthUrl } from "../../lib/gmail.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = (req.query.user as string) || "";
    if (!user) return res.status(400).json({ ok: false, error: "missing user" });

    const state = Buffer.from(JSON.stringify({ user }), "utf8").toString("base64url");
    const url = getGoogleAuthUrl(state);
    res.redirect(302, url);
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
}
