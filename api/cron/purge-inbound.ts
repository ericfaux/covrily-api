// api/cron/purge-inbound.ts
// Deletes inbound_emails older than 30 days. Safe 200 regardless (so cron doesn't thrash).

import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  try {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(url, key, { auth: { persistSession: false } });

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { count, error } = await supabase
      .from("inbound_emails")
      .delete({ count: "exact" })
      .lt("created_at", cutoff);

    if (error) throw error;

    return res.status(200).json({ ok: true, deleted: count, older_than: cutoff });
  } catch (e: any) {
    console.error("PURGE_INBOUND_ERROR", e);
    return res.status(200).json({ ok: false, error: e?.message || "error" });
  }
}
