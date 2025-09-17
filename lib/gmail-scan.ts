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

const HEADERS = ["From", "Subject", "Date"];

const AGGREGATOR_BUCKETS: { domain: string; label: string }[] = [
  { domain: "shopify.com", label: "Shopify Sellers" },
  { domain: "squareup.com", label: "Square Sellers" },
  { domain: "paypal.com", label: "PayPal Receipts" },
];

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
  const m =
    subject.match(/\bfrom\s+([^:-]+)/i) || subject.match(/\bat\s+([^:-]+)/i);
  return m ? m[1].trim() : null;
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bucketForAggregator(domain: string | null): { domain: string; name: string } | null {
  if (!domain) return null;
  for (const bucket of AGGREGATOR_BUCKETS) {
    if (domain === bucket.domain || domain.endsWith(`.${bucket.domain}`)) {
      return { domain: bucket.domain, name: bucket.label };
    }
  }
  return null;
}

function toDisplayName(domain: string, fallback?: string | null): string {
  const parts = domain.replace(/\.com$|\.net$|\.org$|\.co$|\.io$/i, "").split(".");
  const base = parts[0] || fallback || domain;
  return base
    .split(/[-_]/)
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : ""))
    .filter(Boolean)
    .join(" ");
}

function buildMerchantName(
  domain: string | null,
  from: string,
  subject: string
): { domain: string | null; name: string | null } {
  if (domain) {
    const bucket = bucketForAggregator(domain);
    if (bucket) {
      return { domain: bucket.domain, name: bucket.name };
    }
  }

  const display = normalizeWhitespace(extractDisplayName(from) || "");
  if (display) {
    return { domain, name: display };
  }

  if (domain) {
    return { domain, name: toDisplayName(domain) };
  }

  const subjectMerchant = extractMerchantFromSubject(subject);
  if (subjectMerchant) {
    return { domain: null, name: normalizeWhitespace(subjectMerchant) };
  }
  return { domain, name: null };
}

function computeDateWindow(monthsRaw?: string | number | null): string {
  const months = Number.parseInt(String(monthsRaw ?? ""), 10);
  const fallbackMonths = Number.isFinite(months) && months > 0 ? months : 12;
  const since = new Date();
  since.setMonth(since.getMonth() - fallbackMonths);
  const yyyy = since.getFullYear();
  const mm = String(since.getMonth() + 1).padStart(2, "0");
  const dd = String(since.getDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}`;
}

type Gmail = ReturnType<typeof google.gmail>;

interface HeaderLookup {
  from?: string;
  subject?: string;
  date?: string;
}

async function fetchMetadata(
  gmail: Gmail,
  id: string
): Promise<HeaderLookup | null> {
  try {
    const resp = await withRetry(
      () =>
        gmail.users.messages.get({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: HEADERS,
        }),
      "users.messages.get"
    );
    const headers = resp.data.payload?.headers || [];
    const lookup: HeaderLookup = {};
    for (const h of headers) {
      const name = (h.name || "").toLowerCase();
      if (name === "from") lookup.from = h.value || undefined;
      if (name === "subject") lookup.subject = h.value || undefined;
      if (name === "date") lookup.date = h.value || undefined;
    }
    return lookup;
  } catch (err) {
    console.warn("[gmail][discovery] metadata fetch failed", err);
    return null;
  }
}

async function listMessages(
  gmail: Gmail,
  query: string,
  skipIds: Set<string>
): Promise<{ ids: string[]; headers: Map<string, HeaderLookup> }> {
  const ids: string[] = [];
  const headers = new Map<string, HeaderLookup>();
  let pageToken: string | undefined;
  do {
    const resp: any = await withRetry(
      () =>
        gmail.users.messages.list(
          {
            userId: "me",
            q: query,
            maxResults: 500,
            pageToken,
            format: "metadata",
            metadataHeaders: HEADERS,
          } as any
        ),
      "users.messages.list"
    );
    const messages = (resp?.data?.messages as any[]) || [];
    for (const message of messages) {
      const id = message.id;
      if (!id || skipIds.has(id)) continue;
      ids.push(id);
      if (Array.isArray((message as any).payload?.headers)) {
        const lookup: HeaderLookup = {};
        for (const h of (message as any).payload.headers) {
          const name = (h.name || "").toLowerCase();
          if (name === "from") lookup.from = h.value || undefined;
          if (name === "subject") lookup.subject = h.value || undefined;
          if (name === "date") lookup.date = h.value || undefined;
        }
        if (lookup.from || lookup.subject) headers.set(id, lookup);
      }
    }
    pageToken = resp?.data?.nextPageToken || undefined;
    if (!pageToken) break;
  } while (true);

  const missingIds = ids.filter((id) => !headers.has(id));
  if (missingIds.length > 0) {
    await Promise.all(
      missingIds.map(async (id) => {
        const meta = await fetchMetadata(gmail, id);
        if (meta) headers.set(id, meta);
      })
    );
  }

  return { ids, headers };
}

export type MerchantDiscoverySource = "smartlabel" | "heuristic";

export interface MerchantDiscoveryItem {
  name: string;
  domain: string;
  est_count: number;
  source: MerchantDiscoverySource;
}

export interface MerchantDiscoveryResult {
  merchants: MerchantDiscoveryItem[];
}

export async function scanGmailMerchants(
  userId: string,
  tokensOverride?: GmailAccessTokenResult | null
): Promise<MerchantDiscoveryResult> {
  const tokens = tokensOverride ?? (await getAccessToken(userId));
  if (!tokens) return { merchants: [] };
  if (tokens.status && String(tokens.status).toLowerCase() === "reauth_required") {
    return { merchants: [] };
  }

  const gmail = google.gmail({ version: "v1", auth: tokens.client });
  const dateStr = computeDateWindow(process.env.GMAIL_DISCOVERY_MONTHS);

  const subjectClause =
    'subject:(receipt OR "receipt for" OR order OR "your order" OR invoice OR purchase OR bill OR transaction OR payment OR confirmation OR statement)';

  const q1 = [
    subjectClause,
    "(label:^smartlabel_receipt OR category:updates)",
    `after:${dateStr}`,
  ].join(" ");
  const q2 = [subjectClause, "category:updates", `after:${dateStr}`].join(" ");

  const aggregates = new Map<string, MerchantDiscoveryItem>();
  const seenIds = new Set<string>();

  const runQuery = async (query: string, source: MerchantDiscoverySource) => {
    const { ids, headers } = await listMessages(gmail, query, seenIds);
    for (const id of ids) seenIds.add(id);
    console.info("[gmail][discovery]", { q: query, source, found: ids.length });
    for (const id of ids) {
      const header = headers.get(id);
      if (!header) continue;
      const from = header.from || "";
      const subject = header.subject || "";
      const domain = extractDomain(from);
      const { domain: mappedDomain, name } = buildMerchantName(domain, from, subject);
      if (!mappedDomain || !name) continue;
      const domainKey = mappedDomain.toLowerCase();
      const existing = aggregates.get(domainKey);
      if (existing) {
        existing.est_count += 1;
        if (existing.source !== "smartlabel" && source === "smartlabel") {
          existing.source = "smartlabel";
        }
        if (!existing.name && name) existing.name = name;
      } else {
        aggregates.set(domainKey, {
          domain: domainKey,
          name,
          est_count: 1,
          source,
        });
      }
    }
    return ids.length;
  };

  const firstCount = await runQuery(q1, "smartlabel");
  if (firstCount === 0) {
    await runQuery(q2, "heuristic");
  } else {
    await runQuery(q2, "heuristic");
  }

  const merchants = Array.from(aggregates.values()).sort(
    (a, b) => b.est_count - a.est_count
  );

  console.info("[gmail][discovery]", {
    event: "discovery_complete",
    user_id: userId,
    merchants: merchants.length,
  });

  return { merchants };
}

