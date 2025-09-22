// api/gmail/auth.ts
// Assumes caller validates the user identity upstream; trade-off keeps handler simple and focused on
// generating an OAuth link while relying on state payload for downstream verification.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getGmailAuthUrl } from "../../lib/gmail.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = (req.query.user as string) || "";
    if (!user) return res.status(400).json({ ok: false, error: "missing user" });

    const url = getGmailAuthUrl({ user });
    res.redirect(302, url);
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
}
