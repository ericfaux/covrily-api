import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  const user = (req.query.user as string) || "";
  if (!user) return res.status(400).json({ ok:false, error:"missing user" });

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rows, error } = await supabase
    .from("deadlines")
    .select("id, receipt_id, type, status, due_at, decision, decision_note, last_notified_at, heads_up_notified_at")
    .eq("user_id", user)
    .order("due_at", { ascending: true });

  if (error) return res.status(500).json({ ok:false, error });
  return res.status(200).json({ ok:true, deadlines: rows });
}
