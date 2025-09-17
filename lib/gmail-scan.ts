// lib/gmail-scan.ts
import { google } from "googleapis";
import { getDomain } from "tldts";
import { supabaseAdmin } from "./supabase-admin.js";
import { withRetry } from "./retry.js";

const CLIENT_ID = process.env.GMAIL_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.GMAIL_REDIRECT_URI || "";

/**
 * Fetch a valid Gmail access token for the user.
 */
export interface GmailAccessTokenResult {
  client: any;
  accessToken: string;
  grantedScopes: string[];
  status: string | null;
}

export async function getAccessToken(
  userId: string
): Promise<GmailAccessTokenResult | null> {
  const { data, error } = await supabaseAdmin
    .from("gmail_tokens")
    .select(
      "refresh_token, access_token, access_token_expires_at, granted_scopes, status"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data || !data.refresh_token) return null;

  const client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  const refreshToken = data.refresh_token as string;
  const accessToken = data.access_token as string | null;
  const expiry = data.access_token_expires_at ? new Date(data.access_token_expires_at).getTime() : undefined;

  client.setCredentials({ refresh_token: refreshToken, access_token: accessToken || undefined, expiry_date: expiry });
  const { token } = await client.getAccessToken();
  if (!token) return null;

  let tokenScopes: string[] | null = null;
  const storedScopes = Array.isArray((data as any).granted_scopes)
    ? ((data as any).granted_scopes as any[])
        .map((scope) => (typeof scope === "string" ? scope.trim() : ""))
        .filter((scope): scope is string => scope.length > 0)
    : [];
  let grantedScopes = storedScopes;
  try {
    const info = await client.getTokenInfo(token);
    if (info?.scopes && Array.isArray(info.scopes)) {
      tokenScopes = info.scopes
        .map((scope) => (typeof scope === "string" ? scope.trim() : ""))
        .filter((scope) => scope.length > 0);
    } else if (info && typeof (info as any).scope === "string") {
      tokenScopes = (info as any).scope
        .split(/\s+/)
        .map((scope: string) => scope.trim())
        .filter((scope: string) => scope.length > 0);
    }
  } catch (err) {
    console.warn("[gmail] failed to fetch token info", err);
  }

  if (tokenScopes && tokenScopes.length > 0) {
    const uniqueScopes = Array.from(new Set(tokenScopes));
    grantedScopes = uniqueScopes;
    (client.credentials as any).scopes = uniqueScopes;
    (client.credentials as any).scope = uniqueScopes.join(" ");
    (client as any).scopes = uniqueScopes;
  } else if (grantedScopes.length > 0) {
    (client.credentials as any).scopes = grantedScopes;
    (client.credentials as any).scope = grantedScopes.join(" ");
    (client as any).scopes = grantedScopes;
  }

  // persist new access token if it changed
  if (token !== accessToken) {
    const expiryDate = client.credentials.expiry_date
      ? new Date(client.credentials.expiry_date).toISOString()
      : null;
    await supabaseAdmin
      .from("gmail_tokens")
      .update({
        access_token: token,
        access_token_expires_at: expiryDate,
        granted_scopes: grantedScopes,
      })
      .eq("user_id", userId);
  } else if (
    tokenScopes &&
    tokenScopes.length > 0 &&
    ([...storedScopes].sort().join("|") !== [...grantedScopes].sort().join("|"))
  ) {
    await supabaseAdmin
      .from("gmail_tokens")
      .update({ granted_scopes: grantedScopes })
      .eq("user_id", userId);
  }

  return {
    client,
    accessToken: token,
    grantedScopes,
    status: ((data as any).status as string | null) || null,
  };
}

function extractDomain(from: string): string | null {
  const match = from.match(/@([^>\s]+)/);
  if (!match) return null;
  return getDomain(match[1].toLowerCase()) || null;
}

function extractDisplayName(from: string): string | null {
  const match = from.match(/^(.*)<[^>]+>/);
  if (!match) return null;
  const name = match[1].replace(/["']/g, "").trim();
  return name || null;
}

function extractMerchantFromSubject(subject: string): string | null {
  const m = subject.match(/\bfrom\s+([^:-]+)/i) || subject.match(/\bat\s+([^:-]+)/i);
  return m ? m[1].trim() : null;
}

function normalizeMerchant(value: string): string {
  return value.trim().replace(/^["']+|["']+$/g, "").toLowerCase();
}

const GENERIC_DOMAINS = ["shopify.com"];

function isGenericDomain(domain: string): boolean {
  return GENERIC_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export async function scanGmailMerchants(
  userId: string,
  tokensOverride?: GmailAccessTokenResult | null
): Promise<string[]> {
  const tokens = tokensOverride ?? (await getAccessToken(userId));
  if (!tokens) return [];
  if (tokens.status && String(tokens.status).toLowerCase() === "reauth_required") {
    return [];
  }

  const { client } = tokens;
  const gmail = google.gmail({ version: "v1", auth: client });

  const since = new Date();
  since.setMonth(since.getMonth() - 12);
  const dateStr = `${since.getFullYear()}/${String(since.getMonth() + 1).padStart(2, "0")}/${String(
    since.getDate()
  ).padStart(2, "0")}`;
  const subjectQuery =
    'subject:(receipt OR order OR invoice OR purchase OR bill OR transaction OR payment OR confirmation OR statement OR "your order" OR "receipt for")';
  const discoveryQueries = {
    primary: [
      subjectQuery,
      "(label:^smartlabel_receipt OR category:updates)",
      `after:${dateStr}`,
    ].join(" "),
    fallback: [subjectQuery, "category:updates", `after:${dateStr}`].join(" "),
  };
  const keywordRegex =
    /\b(receipt(?:\s+for)?|your\s+order|invoice|purchase|bill|transaction|payment|confirmation|statement|order)\b/i;

  const MAX_QUALIFYING = 100;
  const MAX_SCANNED = 500;

  async function collectMerchantsForQuery(query: string) {
    const merchantsForQuery = new Set<string>();
    let pageToken: string | undefined;
    let totalScanned = 0;
    let qualifying = 0;
    let messageCount = 0;

    while (totalScanned < MAX_SCANNED && qualifying < MAX_QUALIFYING) {
      const res = await withRetry(
        () =>
          gmail.users.messages.list({
            userId: "me",
            labelIds: ["INBOX"],
            q: query,
            maxResults: Math.min(MAX_SCANNED - totalScanned, 500),
            pageToken,
          }),
        "users.messages.list"
      );

      const messages = res.data.messages || [];
      if (messages.length === 0) break;
      messageCount += messages.length;

      const ids = messages.map((m) => m.id).filter((id): id is string => !!id);
      const BATCH_SIZE = 10;

      for (
        let i = 0,
          len = ids.length;
        i < len && totalScanned < MAX_SCANNED && qualifying < MAX_QUALIFYING;
        i += BATCH_SIZE
      ) {
        const batchIds = ids.slice(i, i + BATCH_SIZE);
        const metas = await Promise.all(
          batchIds.map((id) =>
            withRetry(
              () =>
                gmail.users.messages.get({
                  userId: "me",
                  id,
                  format: "metadata",
                  metadataHeaders: ["From", "Subject"],
                }),
              "users.messages.get"
            ).catch(() => null)
          )
        );

        for (const meta of metas) {
          if (!meta) continue;
          const headers = meta.data.payload?.headers || [];
          const from = headers.find((h: any) => (h.name || "").toLowerCase() === "from")?.value;
          const subject = headers
            .find((h: any) => (h.name || "").toLowerCase() === "subject")
            ?.value;
          totalScanned++;
          if (!from || !subject || !keywordRegex.test(subject)) continue;
          qualifying++;
          const domain = extractDomain(from);
          const display = extractDisplayName(from);
          if (domain && /amazon\./i.test(domain)) continue;
          let merchant = domain;
          if (!merchant || isGenericDomain(merchant)) {
            merchant = display || extractMerchantFromSubject(subject);
          }
          if (merchant) {
            merchantsForQuery.add(normalizeMerchant(merchant));
          }
          if (totalScanned >= MAX_SCANNED || qualifying >= MAX_QUALIFYING) break;
        }
      }

      if (
        totalScanned >= MAX_SCANNED ||
        qualifying >= MAX_QUALIFYING ||
        !res.data.nextPageToken
      ) {
        break;
      }
      pageToken = res.data.nextPageToken;
    }

    return { merchants: merchantsForQuery, messageCount };
  }

  const primaryResult = await collectMerchantsForQuery(discoveryQueries.primary);
  const merchants = new Set(primaryResult.merchants);

  if (primaryResult.messageCount === 0) {
    const fallbackResult = await collectMerchantsForQuery(discoveryQueries.fallback);
    for (const merchant of fallbackResult.merchants) {
      merchants.add(merchant);
    }
  }

  return Array.from(merchants);
}

