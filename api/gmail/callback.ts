// PATH: api/gmail/callback.ts
// Assumes Google OAuth state arrives as base64url JSON containing the user id; trade-off is decoding
// and validating the payload manually to keep the handler independent of external frameworks while
// persisting refresh/access tokens atomically in Supabase.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exchangeCodeForTokens } from "../../lib/gmail.js";
import { supabaseAdmin } from "../../lib/supabase-admin.js";

function decodeState(rawState: string): { user: string } | null {
  try {
    const json = Buffer.from(rawState, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as any).user === "string" &&
      (parsed as any).user.trim()
    ) {
      return { user: (parsed as any).user.trim() };
    }
  } catch {
    // ignore decode errors and return null
  }
  return null;
}

function extractScopes(raw: unknown): string[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    return raw
      .split(/\s+/)
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0);
  }
  if (Array.isArray(raw)) {
    return Array.from(
      new Set(
        raw
          .map((scope) => (typeof scope === "string" ? scope.trim() : ""))
          .filter((scope): scope is string => scope.length > 0)
      )
    );
  }
  return [];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const rawState = typeof req.query.state === "string" ? req.query.state : "";

  if (!rawState) {
    return res.status(400).send("Missing or invalid state");
  }

  const state = decodeState(rawState);
  if (!state?.user) {
    return res.status(400).send("Missing or invalid state");
  }

  if (!code) {
    return res.status(400).send("Missing authorization code");
  }

  const user = state.user;

  try {
    const tokens = await exchangeCodeForTokens(code);
    const refreshToken =
      typeof tokens.refresh_token === "string" && tokens.refresh_token.trim().length > 0
        ? tokens.refresh_token.trim()
        : null;
    const accessToken =
      typeof tokens.access_token === "string" && tokens.access_token.trim().length > 0
        ? tokens.access_token.trim()
        : null;

    let finalRefreshToken = refreshToken;
    if (!finalRefreshToken) {
      const { data: existingTokenRow, error: existingTokenError } = await supabaseAdmin
        .from("gmail_tokens")
        .select("refresh_token")
        .eq("user_id", user)
        .maybeSingle();
      if (existingTokenError) {
        throw existingTokenError;
      }
      if (existingTokenRow?.refresh_token) {
        finalRefreshToken = existingTokenRow.refresh_token as string;
      }
    }

    if (!finalRefreshToken) {
      throw new Error("missing refresh token");
    }

    const expiresIn = typeof tokens.expires_in === "number" ? tokens.expires_in : null;
    const expiresAt =
      expiresIn && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
    const grantedScopes = extractScopes(tokens.scope);

    const { error: upsertError } = await supabaseAdmin
      .from("gmail_tokens")
      .upsert(
        {
          user_id: user,
          refresh_token: finalRefreshToken,
          access_token: accessToken,
          access_token_expires_at: expiresAt,
          granted_scopes: grantedScopes,
          status: "active",
          reauth_required: false,
        },
        { onConflict: "user_id" }
      );

    if (upsertError) {
      throw upsertError;
    }

    return res.redirect(302, `/api/gmail/merchants-ui?user=${encodeURIComponent(user)}`);
  } catch (e: any) {
    const qs = user ? `user=${encodeURIComponent(user)}&` : "";
    return res.redirect(302, `/api/gmail/ui?${qs}status=error`);
  }
}
