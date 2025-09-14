// api/gmail/merchants.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { listCandidateMerchants } from "../../lib/gmail-scan.js";
import { upsertAuthorizedMerchants } from "../../lib/merchants.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = (req.query.user as string) || "";
  if (!user) return res.status(400).json({ ok: false, error: "missing user" });

  if (req.method === "GET") {
    try {
      const merchants = await listCandidateMerchants(user);
      return res.status(200).json({ ok: true, merchants });
    } catch (e: any) {
      return res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  }

  if (req.method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const merchants = Array.isArray(body?.merchants) ? body.merchants : [];
      await upsertAuthorizedMerchants(user, merchants);
      return res.status(200).json({ ok: true });
    } catch (e: any) {
      return res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  }

  res.setHeader("Allow", "GET,POST");
  return res.status(405).end();
}
