// lib/supabase-admin.ts
// Assumes runtime always supplies service role credentials for privileged writes;
// trade-off is failing fast during init instead of attempting degraded anon access.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
if (!url) {
  throw new Error("SUPABASE_URL not set – admin writes will fail");
}

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY not set – admin writes will fail");
}

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
