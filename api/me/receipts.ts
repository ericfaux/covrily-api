import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  const user = (req.query.user as string) || "";
  if (!user) return res.status(400).json({ ok:false, error:"missing user" });

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: receipts, error } = await supabase
    .from("receipts")
    .select("id, merchant, order_id, total_cents, purchase_date")
    .eq("user_id", user)
    .order("purchase_date", { ascending: false });

  if (error) return res.status(500).json({ ok:false, error });
  return res.status(200).json({ ok:true, receipts });
}
