// api/gmail/callback.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exchangeCodeForTokens } from "../../lib/gmail.js";
import { supabaseAdmin } from "../../lib/supabase-admin.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const code = (req.query.code as string) || "";
    const state = (req.query.state as string) || "";
    if (!code || !state) return res.status(400).json({ ok: false, error: "missing code or state" });

    let user: string;
    try {
      const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
      user = parsed.user;
    } catch {
      return res.status(400).json({ ok: false, error: "invalid state" });
    }
    if (!user) return res.status(400).json({ ok: false, error: "missing user" });

    const tokens = await exchangeCodeForTokens(code);
    const expires = tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null;
    await supabaseAdmin
      .from("gmail_tokens")
      .upsert({
        user_id: user,
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token,
        access_token_expires_at: expires,
      }, { onConflict: "user_id" });

    res.status(200).json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
}
