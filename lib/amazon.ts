// lib/amazon.ts
import { supabaseAdmin } from "./supabase-admin.js";

const CLIENT_ID = process.env.AMAZON_CLIENT_ID || "";
const CLIENT_SECRET = process.env.AMAZON_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.AMAZON_REDIRECT_URI || "";

const AUTH_URL = "https://www.amazon.com/ap/oa";
const TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const SCOPES = "profile profile:user_id sellingpartnerapi::orders"; // include order access if available

export function getAmazonAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: SCOPES,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<any> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  return res.json();
}

export async function getValidAccessToken(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("amazon_access_token, amazon_refresh_token, amazon_access_token_expires_at")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return null;
  const { amazon_access_token, amazon_refresh_token, amazon_access_token_expires_at } = data as any;
  const expiresAt = amazon_access_token_expires_at ? new Date(amazon_access_token_expires_at) : null;
  if (
    amazon_access_token &&
    expiresAt &&
    expiresAt.getTime() > Date.now() + 60 * 1000
  ) {
    return amazon_access_token;
  }
  if (!amazon_refresh_token) return null;

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: amazon_refresh_token,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
  const json = await res.json();

  const expires = new Date(Date.now() + (json.expires_in || 3600) * 1000).toISOString();
  await supabaseAdmin
    .from("profiles")
    .update({
      amazon_access_token: json.access_token,
      amazon_refresh_token: json.refresh_token || amazon_refresh_token,
      amazon_access_token_expires_at: expires,
    })
    .eq("id", userId);

  return json.access_token as string;
}

