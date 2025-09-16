// api/gmail/callback.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createOAuthClient, exchangeCodeForTokens } from "../../lib/gmail.js";
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

    const client = createOAuthClient();
    client.setCredentials(tokens);

    let grantedScopes: string[] = [];
    if (tokens.access_token) {
      try {
        const info = await client.getTokenInfo(tokens.access_token);
        const scopes = Array.isArray(info?.scopes)
          ? info.scopes
          : typeof (info as any)?.scope === "string"
          ? (info as any).scope.split(/\s+/)
          : [];
        grantedScopes = Array.from(
          new Set(
            scopes
              .map((scope: any) => (typeof scope === "string" ? scope.trim() : ""))
              .filter((scope: string) => scope.length > 0)
          )
        );
      } catch (err) {
        console.warn("[gmail] failed to fetch granted scopes during callback", err);
      }
    }

    await supabaseAdmin
      .from("gmail_tokens")
      .upsert(
        {
          user_id: user,
          refresh_token: tokens.refresh_token,
          access_token: tokens.access_token,
          access_token_expires_at: expires,
          granted_scopes: grantedScopes,
          status: "active",
        },
        { onConflict: "user_id" }
      );

    if (grantedScopes.length > 0) {
      const maskedUser =
        user.length > 8 ? `${user.slice(0, 4)}…${user.slice(-2)}` : user || "unknown";
      console.info("[gmail] linked user scopes", {
        user: maskedUser,
        scopes: grantedScopes,
      });
    }

    res.redirect(302, `/api/gmail/merchants-ui?user=${encodeURIComponent(user)}`);
  } catch (e: any) {
    const qs = user ? `user=${encodeURIComponent(user)}&` : "";
    res.redirect(302, `/api/gmail/ui?${qs}status=error`);
  }
}
