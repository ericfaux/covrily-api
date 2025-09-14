// lib/gmail-scan.ts
import { google } from "googleapis";
import { oauthClient } from "./gmail.js";
import { supabaseAdmin } from "./supabase-admin.js";

interface GmailTokenRow {
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
}

async function gmailClient(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("gmail_tokens")
    .select("refresh_token, access_token, access_token_expires_at")
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new Error("missing Gmail token for user");
  const row = data as GmailTokenRow;
  const client = oauthClient();
  client.setCredentials({
    refresh_token: row.refresh_token,
    access_token: row.access_token ?? undefined,
    expiry_date: row.access_token_expires_at
      ? new Date(row.access_token_expires_at).getTime()
      : undefined,
  });
  return google.gmail({ version: "v1", auth: client });
}

export async function listCandidateMerchants(userId: string): Promise<string[]> {
  const gmail = await gmailClient(userId);
  const list = await gmail.users.messages.list({ userId: "me", maxResults: 50 });
  const ids = list.data.messages?.map((m) => m.id) ?? [];
  const merchants = new Set<string>();
  for (const id of ids) {
    const msg = await gmail.users.messages.get({
      userId: "me",
      id: id!,
      format: "metadata",
      metadataHeaders: ["From"],
    });
    const from = msg.data.payload?.headers?.find(
      (h) => h.name?.toLowerCase() === "from"
    )?.value;
    if (from) {
      const match = from.match(/<([^>]+)>/);
      const email = match ? match[1] : from;
      const domain = email.split("@")[1] || email;
      merchants.add(domain.toLowerCase());
    }
  }
  return Array.from(merchants);
}

export async function gmailClientForUser(userId: string) {
  return gmailClient(userId);
}
