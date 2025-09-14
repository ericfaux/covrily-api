// lib/gmail-scan.ts
import { google } from "googleapis";
import { supabaseAdmin } from "./supabase-admin.js";

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
  const domain = match[1].toLowerCase();
  // strip any surrounding punctuation and subdomains
  return domain.replace(/^[^\w]+|[^\w]+$/g, "");
}

export async function scanGmailMerchants(
  userId: string,
  limit = Number(process.env.GMAIL_SCAN_LIMIT || 100)
): Promise<string[]> {
  const tokens = await getAccessToken(userId);
  if (!tokens) return [];
  const { client } = tokens;
  const gmail = google.gmail({ version: "v1", auth: client });

  const since = new Date();
  since.setFullYear(since.getFullYear() - 1);
  const dateStr = `${since.getFullYear()}/${String(since.getMonth() + 1).padStart(2, "0")}/${String(
    since.getDate()
  ).padStart(2, "0")}`;
  const q = `(receipt OR order OR invoice OR purchase OR bill OR transaction) after:${dateStr}`;
  const keywordRegex = /\b(receipt|order|invoice|purchase|bill|transaction)\b/i;

  const merchants = new Set<string>();
  let pageToken: string | undefined;
  let fetched = 0;
  const start = Date.now();
  const maxMs = Number(process.env.GMAIL_SCAN_TIMEOUT_MS || 8000);
  const batchSize = 20;

  while (fetched < limit && Date.now() - start < maxMs) {
    const res = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["INBOX"],
      q,
      maxResults: Math.min(100, limit - fetched),
      pageToken,
    });

    const messages = res.data.messages || [];
    if (messages.length === 0) break;

    // fetch message metadata in small batches for speed
    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize).filter(m => m.id);
      const metas = await Promise.allSettled(
        batch.map(m =>
          gmail.users.messages.get({
            userId: "me",
            id: m.id!,
            format: "metadata",
            metadataHeaders: ["From", "Subject"],
          })
        )
      );

      for (const meta of metas) {
        if (meta.status !== "fulfilled") continue;
        const headers = meta.value.data.payload?.headers || [];
        const from = headers.find((h: any) => (h.name || "").toLowerCase() === "from")?.value;
        const subject = headers
          .find((h: any) => (h.name || "").toLowerCase() === "subject")
          ?.value;
        if (!from || !subject || !keywordRegex.test(subject)) continue;
        const domain = extractDomain(from);
        if (!domain || domain.includes("amazon.")) continue;
        merchants.add(domain);
      }

      if (Date.now() - start >= maxMs) break;
    }

    fetched += messages.length;
    if (!res.data.nextPageToken) break;
    pageToken = res.data.nextPageToken;
  }

  return Array.from(merchants);
}

