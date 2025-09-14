import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  const user = (req.query.user as string) || "";
  if (!user) return res.status(400).json({ ok:false, error:"missing user" });

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rows, error } = await supabase
    .from("approved_merchants")
    .select("merchant")
    .eq("user_id", user)
    .order("merchant", { ascending: true });

  if (error) return res.status(500).json({ ok:false, error });

  const merchants = (rows || []).map((r: any) => r.merchant);
  return res.status(200).json({ ok:true, merchants });
}
