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

const KEYWORDS = /(receipt|order|invoice|purchase|bill|transaction)/i;

function rootDomain(domain: string): string {
  const parts = domain.toLowerCase().split(".");
  return parts.length <= 2 ? domain.toLowerCase() : parts.slice(-2).join(".");
}

function extractDomain(from: string): string | null {
  const match = from.match(/@([^>\s]+)/);
  if (!match) return null;
  const domain = rootDomain(match[1]);
  // ignore amazon domains
  if (/amazon\./i.test(domain)) return null;
  return domain;
}

export async function scanGmailMerchants(userId: string): Promise<string[]> {
  const tokens = await getAccessToken(userId);
  if (!tokens) return [];
  const { client } = tokens;
  const gmail = google.gmail({ version: "v1", auth: client });

  const date = new Date();
  date.setFullYear(date.getFullYear() - 1);
  const dateStr = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
  const query = `(receipt OR order OR invoice OR purchase OR bill OR transaction) after:${dateStr}`;

  const merchants = new Set<string>();
  let pageToken: string | undefined;
  const MAX_PAGES = 5; // cap to avoid long-running scans

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data } = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 500,
      pageToken,
      labelIds: ["INBOX"],
    });
    const messages = data.messages || [];
    if (messages.length === 0) break;

    // fetch headers in small concurrent batches
    for (let i = 0; i < messages.length; i += 10) {
      const slice = messages.slice(i, i + 10);
      const results = await Promise.allSettled(
        slice.map((m) =>
          gmail.users.messages.get({
            userId: "me",
            id: m.id!,
            format: "metadata",
            metadataHeaders: ["From", "Subject"],
          })
        )
      );

      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const headers = r.value.data.payload?.headers || [];
        const from = headers.find((h: any) => h.name?.toLowerCase() === "from")?.value;
        const subject = headers.find((h: any) => h.name?.toLowerCase() === "subject")?.value || "";
        if (!from || !KEYWORDS.test(subject)) continue;
        const domain = extractDomain(from);
        if (domain) merchants.add(domain);
      }
    }

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return Array.from(merchants);
}

