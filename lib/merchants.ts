// lib/merchants.ts
import { supabaseAdmin } from "./supabase-admin.js";

/**
 * Persist the merchants a user has authorized.
 *
 * The Gmail integration should parse a list of merchants from the user's
 * inbox. That list is passed here; each entry is stored in the auth_merchants
 * table so later services know which merchants to fetch/parse from Gmail.
 */
export async function upsertAuthorizedMerchants(
  userId: string,
  merchants: string[]
) {
  const rows = merchants.map((m) => ({ user_id: userId, merchant: m }));
  const { error } = await supabaseAdmin
    .from("auth_merchants")
    .upsert(rows, { onConflict: "user_id,merchant" });
  if (error) throw error;
}

/**
 * Return the merchants a user has authorized for receipt ingestion.
 */
export async function listAuthorizedMerchants(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("auth_merchants")
    .select("merchant")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((r) => r.merchant as string);
}
