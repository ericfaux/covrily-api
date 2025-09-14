// api/gmail/merchants.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { scanGmailMerchants } from "../../lib/gmail-scan.js";
import { upsertAuthorizedMerchants } from "../../lib/merchants.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") {
      const user = (req.query.user as string) || "";
      if (!user) return res.status(400).json({ ok: false, error: "missing user" });

      const merchants = await scanGmailMerchants(user);
      return res.status(200).json({ ok: true, merchants });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { user, merchants } = body || {};
      if (!user || !Array.isArray(merchants)) {
        return res.status(400).json({ ok: false, error: "missing user or merchants" });
      }

      await upsertAuthorizedMerchants(user, merchants);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET,POST");
    res.status(405).end();
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
}
