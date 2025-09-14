// lib/merchants.ts
import { supabaseAdmin } from "./supabase-admin.js";

export async function saveApprovedMerchants(userId: string, merchants: string[]): Promise<void> {
  if (!userId || !Array.isArray(merchants)) return;

  // Replace existing approved merchants with the provided list
  await supabaseAdmin.from("approved_merchants").delete().eq("user_id", userId);
  if (merchants.length === 0) return;

  const payload = merchants.map((m) => ({ user_id: userId, merchant: m }));
  const { error } = await supabaseAdmin
    .from("approved_merchants")
    .upsert(payload, { onConflict: "user_id,merchant" });

  if (error) throw error;
}
