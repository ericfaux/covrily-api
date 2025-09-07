// api/decisions/index.ts
import type { VercelRequest, VercelResponse } from "vercel";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!ADMIN_TOKEN || req.headers["x-admin-token"] !== ADMIN_TOKEN) return res.status(404).end();

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  if (req.method === "GET") {
    const receiptId = (req.query.receipt_id as string) || "";
    if (!receiptId) return res.status(400).json({ ok: false, error: "receipt_id required" });
    const { data, error } = await supabase
      .from("decisions")
      .select("id, receipt_id, user_id, decision, delta_cents, notes, created_at")
      .eq("receipt_id", receiptId)
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, decisions: data });
  }

  if (req.method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { receipt_id, decision, delta_cents, notes } = body || {};
      if (!receipt_id || !decision) return res.status(400).json({ ok: false, error: "receipt_id and decision required" });
      if (!["keep", "return", "price_adjust"].includes(decision)) return res.status(400).json({ ok: false, error: "invalid decision" });

      // Ensure we attach the true user_id (from the receipt) for integrity
      const { data: rec, error: e1 } = await supabase.from("receipts").select("user_id").eq("id", receipt_id).single();
      if (e1 || !rec?.user_id) return res.status(404).json({ ok: false, error: "receipt not found or no user_id" });

      const { data, error } = await supabase
        .from("decisions")
        .insert([{ receipt_id, user_id: rec.user_id, decision, delta_cents: delta_cents ?? null, notes: notes ?? null }])
        .select()
        .single();

      if (error) return res.status(500).json({ ok: false, error: error.message });
      return res.status(200).json({ ok: true, decision: data });
    } catch (e: any) {
      return res.status(400).json({ ok: false, error: "invalid json body" });
    }
  }

  res.setHeader("Allow", "GET,POST");
  return res.status(405).end();
}
