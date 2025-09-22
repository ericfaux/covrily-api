// lib/gmail.ts
// Assumes Gmail OAuth flows always request offline access and inspect token metadata; trade-off is
// making an extra token info request during callback processing so we persist accurate scopes.
import { google } from "googleapis";

const CLIENT_ID = process.env.GMAIL_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.GMAIL_REDIRECT_URI || "";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.labels",
];

export function createOAuthClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

export function getGmailAuthUrl({ user }: { user: string }): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    state: JSON.stringify({ user }),
    prompt: "consent",
    include_granted_scopes: false,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

export async function getTokenInfo(accessToken: string) {
  const client = createOAuthClient();
  return client.getTokenInfo(accessToken);
}
