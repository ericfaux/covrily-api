// PATH: lib/gmail.ts
// Assumes Gmail tokens in Supabase are refreshable with Google OAuth2 refresh grants; trade-off is
// eagerly refreshing expired tokens and surfacing reauth errors explicitly instead of letting Gmail
// API calls fail generically, which adds a small amount of read/write overhead per refresh.
import { getDomain } from "tldts";
import { supabaseAdmin } from "./supabase-admin.js";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_API_BASE = "https://gmail.googleapis.com";
const TOKEN_BUFFER_MS = 60_000; // refresh when expiry is within the next minute.

const CLIENT_ID = process.env.GMAIL_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.GMAIL_REDIRECT_URI || "";

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
  throw new Error("Gmail OAuth env vars (GMAIL_CLIENT_ID, SECRET, REDIRECT_URI) must be set");
}

export class ReauthorizeNeeded extends Error {
  constructor(message = "Gmail reauthorization required") {
    super(message);
    this.name = "ReauthorizeNeeded";
  }
}

type GmailTokenRow = {
  refresh_token: string | null;
  access_token: string | null;
  access_token_expires_at: string | null;
  granted_scopes?: string[] | null;
};

interface EnsureAccessTokenOptions {
  forceRefresh?: boolean;
}

interface EnsureAccessTokenResult {
  accessToken: string;
  expiresAt: string | null;
}

interface RefreshTokenResult {
  accessToken: string;
  expiresAt: string | null;
  grantedScopes: string[];
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  const expiryTime = Date.parse(expiresAt);
  if (Number.isNaN(expiryTime)) return true;
  return expiryTime - TOKEN_BUFFER_MS <= Date.now();
}

function normalizeScopes(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((scope) => (typeof scope === "string" ? scope.trim() : ""))
          .filter((scope): scope is string => scope.length > 0)
      )
    );
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/\s+/)
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0);
  }
  return [];
}

export async function refreshAccessToken(refreshToken: string): Promise<RefreshTokenResult> {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const payload = await response.json().catch(() => ({}));
  const errorCode = typeof payload?.error === "string" ? payload.error : null;

  if (!response.ok) {
    if (errorCode === "invalid_grant") {
      throw new ReauthorizeNeeded("refresh token rejected by Google");
    }
    const description =
      typeof payload?.error_description === "string"
        ? payload.error_description
        : "failed to refresh Gmail access token";
    throw new Error(description);
  }

  const accessToken = typeof payload?.access_token === "string" ? payload.access_token : "";
  if (!accessToken) {
    throw new Error("Google response missing access_token");
  }

  const expiresInRaw = (payload as any)?.expires_in;
  const expiresIn =
    typeof expiresInRaw === "number"
      ? expiresInRaw
      : typeof expiresInRaw === "string" && Number.isFinite(Number.parseInt(expiresInRaw, 10))
      ? Number.parseInt(expiresInRaw, 10)
      : null;
  const expiresAt =
    expiresIn && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

  const grantedScopes = normalizeScopes((payload as any)?.scope);

  return { accessToken, expiresAt, grantedScopes };
}

export async function ensureAccessToken(
  userId: string,
  options: EnsureAccessTokenOptions = {}
): Promise<EnsureAccessTokenResult> {
  if (!userId || typeof userId !== "string") {
    throw new Error("userId is required");
  }

  const { data, error } = await supabaseAdmin
    .from("gmail_tokens")
    .select("refresh_token, access_token, access_token_expires_at, granted_scopes")
    .eq("user_id", userId)
    .maybeSingle<GmailTokenRow>();

  if (error) {
    throw error;
  }

  if (!data || !data.refresh_token) {
    throw new ReauthorizeNeeded("missing refresh token");
  }

  const hasValidToken =
    !options.forceRefresh && typeof data.access_token === "string" && data.access_token.length > 0;

  if (hasValidToken && !isExpired(data.access_token_expires_at)) {
    return { accessToken: data.access_token as string, expiresAt: data.access_token_expires_at };
  }

  const refreshResult = await refreshAccessToken(data.refresh_token);

  const { error: updateError } = await supabaseAdmin
    .from("gmail_tokens")
    .update({
      access_token: refreshResult.accessToken,
      access_token_expires_at: refreshResult.expiresAt,
      granted_scopes: refreshResult.grantedScopes,
      status: "active",
      reauth_required: false,
    })
    .eq("user_id", userId);

  if (updateError) {
    throw updateError;
  }

  return { accessToken: refreshResult.accessToken, expiresAt: refreshResult.expiresAt };
}

function buildRequestInit(accessToken: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers || {});
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Accept", "application/json");
  return { ...init, headers };
}

async function performGmailFetch(
  userId: string,
  path: string,
  init?: RequestInit,
  forceRefresh = false
): Promise<Response> {
  const { accessToken } = await ensureAccessToken(userId, { forceRefresh });
  const response = await fetch(`${GMAIL_API_BASE}${path}`, buildRequestInit(accessToken, init));
  return response;
}

export async function gmailFetch(
  userId: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  let response = await performGmailFetch(userId, path, init, false);
  if (response.status === 401) {
    response = await performGmailFetch(userId, path, init, true);
    if (response.status === 401) {
      throw new ReauthorizeNeeded("Gmail returned 401 after refresh");
    }
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`Gmail request failed (${response.status}): ${bodyText || "no body"}`);
  }
  return response;
}

function extractFromHeader(headers: any[]): string | null {
  if (!Array.isArray(headers)) return null;
  for (const header of headers) {
    if (!header || typeof header !== "object") continue;
    const name = typeof header.name === "string" ? header.name.toLowerCase() : "";
    if (name === "from") {
      const value = typeof header.value === "string" ? header.value.trim() : "";
      if (value) return value;
    }
  }
  return null;
}

function parseSender(fromHeader: string): { domain: string | null; merchant: string | null; sample: string } {
  const sample = fromHeader.trim();
  const emailMatch = sample.match(/[<\s]([^<>\s]+@[^<>\s]+)>?/);
  const email = emailMatch ? emailMatch[1].toLowerCase() : null;
  const rawDomain = email ? email.split("@")[1] || null : null;
  const domain = rawDomain ? getDomain(rawDomain) || rawDomain : rawDomain;
  const nameMatch = sample.match(/^(.*?)<[^>]+>/);
  const displayName = nameMatch ? nameMatch[1].replace(/["']/g, "").trim() : "";
  const merchant = displayName || (domain ? merchantNameFromDomain(domain) : null);
  return { domain, merchant, sample };
}

function merchantNameFromDomain(domain: string): string {
  const trimmed = domain.replace(/\.(com|net|org|co|io|shop|store)$/gi, "");
  const primary = trimmed.split(".")[0] || domain;
  return primary
    .split(/[-_]/)
    .map((chunk) => (chunk ? chunk[0].toUpperCase() + chunk.slice(1) : ""))
    .filter(Boolean)
    .join(" ") || domain;
}

interface MerchantSummary {
  domain: string;
  merchant: string;
  count: number;
  samples: string[];
}

function aggregateMerchants(records: Array<{ domain: string | null; merchant: string | null; sample: string }>): MerchantSummary[] {
  const map = new Map<string, MerchantSummary>();
  for (const record of records) {
    if (!record.domain) continue;
    const key = record.domain.toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        domain: key,
        merchant: record.merchant || merchantNameFromDomain(key),
        count: 1,
        samples: [record.sample],
      });
      continue;
    }
    existing.count += 1;
    if (record.merchant && !existing.merchant) {
      existing.merchant = record.merchant;
    }
    if (!existing.samples.includes(record.sample) && existing.samples.length < 5) {
      existing.samples.push(record.sample);
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.domain.localeCompare(b.domain);
  });
}

export async function listLikelyMerchants(
  userId: string,
  lookbackDays = 90,
  maxMessages = 50
): Promise<MerchantSummary[]> {
  const safeDays = Number.isFinite(lookbackDays) && lookbackDays > 0 ? Math.floor(lookbackDays) : 90;
  const safeMax = Number.isFinite(maxMessages) && maxMessages > 0 ? Math.min(Math.floor(maxMessages), 500) : 50;

  const query = `newer_than:${safeDays}d -in:spam -in:trash`;
  const params = new URLSearchParams({
    maxResults: String(safeMax),
    q: query,
  });

  const listResponse = await gmailFetch(
    userId,
    `/gmail/v1/users/me/messages?${params.toString()}`,
    { method: "GET" }
  );
  const listPayload = (await listResponse.json()) as any;
  const messages: Array<{ id: string }> = Array.isArray(listPayload?.messages)
    ? listPayload.messages.filter((msg: any) => msg && typeof msg.id === "string")
    : [];

  const results: Array<{ domain: string | null; merchant: string | null; sample: string }> = [];

  for (const message of messages) {
    try {
      const detailResponse = await gmailFetch(
        userId,
        `/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}?format=metadata&metadataHeaders=From`,
        { method: "GET" }
      );
      const detailPayload = (await detailResponse.json()) as any;
      const fromHeader = extractFromHeader(detailPayload?.payload?.headers || []);
      if (!fromHeader) continue;
      results.push(parseSender(fromHeader));
    } catch (err) {
      if (err instanceof ReauthorizeNeeded) {
        throw err;
      }
      console.warn("[gmail] failed to inspect message", {
        userId: userId ? `${userId.slice(0, 4)}…` : "unknown",
        messageId: message.id,
        error: (err as Error)?.message || String(err),
      });
    }
  }

  return aggregateMerchants(results);
}

export function getGoogleAuthUrl(state: string): string {
  if (!state || typeof state !== "string") {
    throw new Error("state is required for Google OAuth");
  }
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "openid",
    ].join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

export interface TokenExchangeResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  token_type?: string;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenExchangeResponse> {
  if (!code || typeof code !== "string") {
    throw new Error("authorization code required");
  }

  const params = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`token exchange failed (${response.status}): ${bodyText || "no body"}`);
  }

  const payload = (await response.json()) as TokenExchangeResponse;
  return payload;
}
