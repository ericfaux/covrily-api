import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"POST only" });

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { id, user, action, note } = req.body || {};
  if (!id || !user || !action) return res.status(400).json({ ok:false, error:"missing id/user/action" });

  const { data: dl } = await supabase
    .from("deadlines")
    .select("id, user_id, status")
    .eq("id", id)
    .single();

  if (!dl || dl.user_id !== user) return res.status(404).json({ ok:false, error:"not found" });

  if (action === "keep" || action === "return") {
    await supabase.from("deadlines").update({
      decision: action,
      decision_note: note ?? null,
      status: "closed",
      closed_at: new Date().toISOString()
    }).eq("id", id);
  } else if (action === "reopen") {
    await supabase.from("deadlines").update({
      decision: null,
      decision_note: null,
      status: "open",
      closed_at: null
    }).eq("id", id);
  } else {
    return res.status(400).json({ ok:false, error:"invalid action" });
  }

  return res.status(200).json({ ok:true, id, action });
}
