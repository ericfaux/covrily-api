// api/gmail/merchants.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { scanGmailMerchants } from "../../lib/gmail-scan.js";
import { saveApprovedMerchants } from "../../lib/merchants.js";
import { supabaseAdmin } from "../../lib/supabase-admin.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") {
      const user = (req.query.user as string) || "";
      if (!user) return res.status(400).json({ ok: false, error: "missing user" });

      const merchants = await scanGmailMerchants(user);
      const uniqueMerchants = Array.from(new Set(merchants));

      // store scanned merchants in auth_merchants table for review
      await supabaseAdmin.from("auth_merchants").delete().eq("user_id", user);
      if (uniqueMerchants.length > 0) {
        const payload = uniqueMerchants.map((m) => ({ user_id: user, merchant: m }));
        await supabaseAdmin
          .from("auth_merchants")
          .upsert(payload, { onConflict: "user_id,merchant" });
      }

      return res.status(200).json({ ok: true, merchants: uniqueMerchants });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { user, merchants } = body || {};
      if (!user || !Array.isArray(merchants)) {
        return res.status(400).json({ ok: false, error: "missing user or merchants" });
      }

      await saveApprovedMerchants(user, merchants);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET,POST");
    res.status(405).end();
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
}
