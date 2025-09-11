// lib/parse-log.ts
import { supabaseAdmin } from "./supabase-admin.js";

export type ParseLogRecord = {
  parser: string;
  merchant: string;
  order_id_found: boolean;
  purchase_date_found: boolean;
  total_cents_found: boolean;
};

/**
 * Insert a parse log into Supabase and emit a structured console log.
 * Fails silently if Supabase insert errors, but always logs to console.
 */
export async function logParseResult(record: ParseLogRecord): Promise<void> {
  try {
    await supabaseAdmin.from("parse_logs").insert([{ ...record }]);
  } catch (e) {
    console.error("[parse-log] insert failed:", e);
  }
  console.log("[parse-log]", record);
}

