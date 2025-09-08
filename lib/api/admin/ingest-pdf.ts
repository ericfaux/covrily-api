// api/admin/ingest-pdf.ts
import type { VercelRequest, VercelResponse } from "vercel";
import { createClient } from "@supabase/supabase-js";
import { parseHmPdf } from "../../lib/pdf";

export const config = { runtime: "nodejs18.x" }; // pdf-parse needs Node

const urlEnv = process.env.SUPABASE_URL!;
const keyEnv = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const ALLOW_QUERY_TOKEN = process.env.ALLOW_QUERY_TOKEN === "true";

function authed(req: VercelRequest): boolean {
  const headerOK = req.headers["x-admin-token"] === ADMIN_TOKEN && !!ADMIN_TOKEN;
  const queryOK = ALLOW_QUERY_TOKEN && typeof req.query.token === "string" && req.query.token === ADMIN_TOKEN;
  return headerOK || queryOK;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authed(req)) return res.status(404).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }

  try {
    const pdfUrl = (req.query.url as string) || "";
    const save = (req.query.save as string) === "1";
    const user_id = (req.query.user_id as string) || "";

    if (!pdfUrl) return res.status(400).json({ ok: false, error: "url required" });

    const r = await fetch(pdfUrl, { method: "GET" }).catch(() => null);
    if (!r || !r.ok) return res.status(400).json({ ok: false, error: "failed to fetch pdf" });
    const buf = Buffer.from(await r.arrayBuffer());

    // H&M-specific parse (simple and fast)
    const preview = await parseHmPdf(buf);

    if (!save) return res.status(200).json({ ok: true, source: "hm-pdf", preview });

    // Save to DB
    const supabase = createClient(urlEnv, keyEnv, { auth: { persistSession: false, autoRefreshToken: false } });

    // Pick a user_id if not supplied
    let uid = user_id;
    if (!uid) {
      const { data: prof } = await supabase.from("profiles").select("id").limit(1).single();
      if (!prof?.id) return res.status(400).json({ ok: false, error: "no profile found; pass user_id explicitly" });
      uid = prof.id;
    }

    const purchase_date = preview.order_date || preview.receipt_date || new Date().toISOString();
    const { data: ins, error: e1 } = await supabase
      .from("receipts")
      .insert([{
        user_id: uid,
        merchant: preview.merchant ?? "hm.com",
        order_id: preview.order_number ?? preview.receipt_number ?? null,
        total_cents: preview.total_cents ?? null,
        purchase_date: purchase_date
      }])
      .select()
      .single();

    if (e1 || !ins?.id) return res.status(500).json({ ok: false, error: e1?.message || "insert failed", preview });

    return res.status(200).json({ ok: true, saved: true, receipt_id: ins.id, preview });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
