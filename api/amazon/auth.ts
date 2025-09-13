// api/amazon/auth.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAmazonAuthUrl } from "../../lib/amazon.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = (req.query.user as string) || "";
    if (!user) return res.status(400).json({ ok: false, error: "missing user" });

    const state = Buffer.from(JSON.stringify({ user })).toString("base64url");
    const url = getAmazonAuthUrl(state);
    res.redirect(302, url);
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
}
