// api/gmail/callback.ts
// Assumes Gmail OAuth state arrives as plain JSON and Supabase retains prior refresh tokens; trade-off
// is rejecting tampered state with a 400 while doing an extra read when Google omits refresh tokens so
// reauthorized users keep working.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exchangeCodeForTokens, getTokenInfo } from "../../lib/gmail.js";
import { supabaseAdmin } from "../../lib/supabase-admin.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const rawState = req.query.state;
  if (typeof rawState !== "string" || !rawState.trim()) {
    return res.status(400).send("Missing or invalid state");
  }

  let user = "";
  try {
    // State payload is JSON encoded upstream; reject anything else so we surface tampering quickly.
    const parsedState = JSON.parse(rawState);
    if (
      !parsedState ||
      typeof parsedState !== "object" ||
      typeof (parsedState as any).user !== "string" ||
      !(parsedState as any).user.trim()
    ) {
      return res.status(400).send("Missing or invalid state");
    }
    user = (parsedState as any).user.trim();
  } catch {
    return res.status(400).send("Missing or invalid state");
  }

  try {
    const maskedUser =
      user.length > 8 ? `${user.slice(0, 4)}…${user.slice(-2)}` : user || "unknown";

    if (!code) throw new Error("missing code");

    const tokens = await exchangeCodeForTokens(code);
    const expires = tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null;

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

    let grantedScopes: string[] = [];
    if (tokens.access_token) {
      try {
        const info = await getTokenInfo(tokens.access_token);
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

    const { error: upsertError } = await supabaseAdmin
      .from("gmail_tokens")
      .upsert(
        {
          user_id: user,
          refresh_token: refreshToken,
          access_token: tokens.access_token,
          access_token_expires_at: expires,
          granted_scopes: grantedScopes,
          status: "active",
          reauth_required: false,
        },
        { onConflict: "user_id" }
      );

    if (upsertError) {
      throw upsertError;
    }

    if (grantedScopes.length > 0) {
      console.info("[gmail] linked user scopes", {
        user: maskedUser,
        scopes: grantedScopes,
      });
    }

    return res.redirect(302, `/api/gmail/merchants-ui?user=${encodeURIComponent(user)}`);
  } catch (e: any) {
    const qs = user ? `user=${encodeURIComponent(user)}&` : "";
    return res.redirect(302, `/api/gmail/ui?${qs}status=error`);
  }
}
