// api/gmail/merchants.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { scanGmailMerchants } from "../../lib/gmail-scan.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = (req.query.user as string) || "";
    if (!user) return res.status(400).json({ ok: false, error: "missing user" });

    const merchants = await scanGmailMerchants(user);
    res.status(200).json({ ok: true, merchants });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
}
