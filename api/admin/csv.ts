// api/admin/csv.ts
import type { VercelRequest, VercelResponse } from "vercel";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

function csvEscape(v: any) {
  const s = (v ?? "").toString();
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!ADMIN_TOKEN || req.headers["x-admin-token"] !== ADMIN_TOKEN) return res.status(404).end();

    const user = (req.query.user as string) || "";
    if (!user) return res.status(400).send("user query param required (auth.users.id)");

    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data, error } = await supabase
      .from("receipts")
      .select(`id, user_id, purchase_date, merchant, order_id, total_cents`)
      .eq("user_id", user)
      .order("purchase_date", { ascending: false });

    if (error) return res.status(500).send(error.message);

    const header = [
      "receipt_id","user_id","purchase_date","merchant","order_id","total_cents_usd"
    ].join(",");

    const rows = (data ?? []).map(r =>
      [r.id, r.user_id, r.purchase_date, r.merchant, r.order_id, r.total_cents ?? ""]
        .map(csvEscape).join(",")
    ).join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="receipts-${user}.csv"`);
    res.status(200).send(header + "\n" + rows + "\n");
  } catch (e: any) {
    res.status(500).send(String(e?.message || e));
  }
}
