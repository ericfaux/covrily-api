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
  return match ? match[1].toLowerCase() : null;
}

export async function scanGmailMerchants(userId: string): Promise<string[]> {
  const tokens = await getAccessToken(userId);
  if (!tokens) return [];
  const { client } = tokens;
  const gmail = google.gmail({ version: "v1", auth: client });

  const list = await gmail.users.messages.list({ userId: "me", maxResults: 50, labelIds: ["INBOX"] });
  const messages = list.data.messages || [];
  const merchants = new Set<string>();

  for (const msg of messages) {
    if (!msg.id) continue;
    const res = await gmail.users.messages.get({ userId: "me", id: msg.id, format: "metadata", metadataHeaders: ["From"] });
    const headers = res.data.payload?.headers || [];
    const from = headers.find((h: any) => (h.name || "").toLowerCase() === "from")?.value;
    if (!from) continue;
    const domain = extractDomain(from);
    if (domain) merchants.add(domain);
  }

  return Array.from(merchants);
}

