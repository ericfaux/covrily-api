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
export async function getAccessToken(
  userId: string
): Promise<{ client: any; accessToken: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("gmail_tokens")
    .select("refresh_token, access_token, access_token_expires_at")
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

  // persist new access token if it changed
  if (token !== accessToken) {
    const expiryDate = client.credentials.expiry_date
      ? new Date(client.credentials.expiry_date).toISOString()
      : null;
    await supabaseAdmin
      .from("gmail_tokens")
      .update({ access_token: token, access_token_expires_at: expiryDate })
      .eq("user_id", userId);
  }

  return { client, accessToken: token };
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

export async function scanGmailMerchants(userId: string): Promise<string[]> {
  const tokens = await getAccessToken(userId);
  if (!tokens) return [];
  const { client } = tokens;
  const gmail = google.gmail({ version: "v1", auth: client });

  const since = new Date();
  since.setMonth(since.getMonth() - 12);
  const dateStr = `${since.getFullYear()}/${String(since.getMonth() + 1).padStart(2, "0")}/${String(
    since.getDate()
  ).padStart(2, "0")}`;
  const q = `subject:(receipt OR order OR invoice OR purchase OR bill OR transaction OR payment OR confirmation OR statement OR "your order" OR "receipt for") (category:updates OR label:purchases) after:${dateStr}`;
  const keywordRegex = /\b(receipt(?:\s+for)?|your\s+order|invoice|purchase|bill|transaction|payment|confirmation|statement|order)\b/i;

  const merchants = new Set<string>();
  let pageToken: string | undefined;
  let totalScanned = 0;
  let qualifying = 0;

  const MAX_QUALIFYING = 100;
  const MAX_SCANNED = 500;

  while (totalScanned < MAX_SCANNED && qualifying < MAX_QUALIFYING) {
    const res = await withRetry(
      () =>
        gmail.users.messages.list({
          userId: "me",
          labelIds: ["INBOX"],
          q,
          maxResults: Math.min(MAX_SCANNED - totalScanned, 500),
          pageToken,
        }),
      "users.messages.list"
    );

    const messages = res.data.messages || [];
    if (messages.length === 0) break;

    // Collect all message IDs for this page
    const ids = messages.map((m) => m.id).filter((id): id is string => !!id);
    const BATCH_SIZE = 10; // limit concurrent Gmail requests

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
          merchants.add(normalizeMerchant(merchant));
        }
        if (totalScanned >= MAX_SCANNED || qualifying >= MAX_QUALIFYING) break;
      }
    }

    if (
      totalScanned >= MAX_SCANNED ||
      qualifying >= MAX_QUALIFYING ||
      !res.data.nextPageToken
    )
      break;
    pageToken = res.data.nextPageToken;
  }

  return Array.from(merchants);
}

