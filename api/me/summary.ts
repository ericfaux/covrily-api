import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  const user = (req.query.user as string) || "";
  if (!user) return res.status(400).json({ ok:false, error:"missing user" });

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [{ data: rc }, { data: dl }] = await Promise.all([
    supabase.from("receipts").select("id").eq("user_id", user),
    supabase.from("deadlines").select("id, status").eq("user_id", user)
  ]);

  const open = (dl||[]).filter(d=>d.status==='open').length;
  const kept = (dl||[]).filter(d=>d.decision==='keep').length;
  const returned = (dl||[]).filter(d=>d.decision==='return').length;

  res.status(200).json({
    ok: true,
    user,
    receipts: (rc||[]).length,
    deadlines: { open, kept, returned }
  });
}
