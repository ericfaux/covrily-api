// api/gmail/callback.ts
// Assumes Supabase already stores prior refresh tokens; trade-off is an extra read when Google omits a refresh token so we do not break reauth'd users.
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

    const maskedUser =
      user.length > 8 ? `${user.slice(0, 4)}…${user.slice(-2)}` : user || "unknown";

    const tokens = await exchangeCodeForTokens(code);
    const expires = tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null;

    const client = createOAuthClient();

    // Preserve an existing refresh token if Google does not return one on this callback.
    let refreshToken = tokens.refresh_token || null;
    if (!refreshToken) {
      const { data: existingTokenRow, error: existingTokenError } = await supabaseAdmin
        .from("gmail_tokens")
        .select("refresh_token")
        .eq("user_id", user)
        .maybeSingle();
      if (existingTokenError) {
        console.error("[gmail] failed to load existing refresh token", {
          error: existingTokenError,
          user: maskedUser,
        });
      }
      if (existingTokenRow?.refresh_token) {
        refreshToken = existingTokenRow.refresh_token as string;
      }
    }

    if (!refreshToken) {
      // Without a refresh token we cannot sustain access, so fail fast and surface an error to the UI.
      throw new Error("missing refresh token");
    }

    client.setCredentials({ ...tokens, refresh_token: refreshToken });

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
          refresh_token: refreshToken,
          access_token: tokens.access_token,
          access_token_expires_at: expires,
          granted_scopes: grantedScopes,
          status: "active",
        },
        { onConflict: "user_id" }
      );

    if (grantedScopes.length > 0) {
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
