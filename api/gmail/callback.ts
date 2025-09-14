// api/gmail/callback.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exchangeCodeForTokens } from "../../lib/gmail.js";
import { supabaseAdmin } from "../../lib/supabase-admin.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  let user = "";
  try {
    const code = (req.query.code as string) || "";
    const state = (req.query.state as string) || "";
    if (!code || !state) throw new Error("missing code or state");

    try {
      const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
      user = parsed.user;
    } catch {
      throw new Error("invalid state");
    }
    if (!user) throw new Error("missing user");

    const tokens = await exchangeCodeForTokens(code);
    const expires = tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null;
    await supabaseAdmin
      .from("gmail_tokens")
      .upsert(
        {
          user_id: user,
          refresh_token: tokens.refresh_token,
          access_token: tokens.access_token,
          access_token_expires_at: expires,
        },
        { onConflict: "user_id" }
      );

    res.redirect(302, `/api/gmail/ui?user=${encodeURIComponent(user)}&status=linked`);
  } catch (e: any) {
    const qs = user ? `user=${encodeURIComponent(user)}&` : "";
    res.redirect(302, `/api/gmail/ui?${qs}status=error`);
  }
}
