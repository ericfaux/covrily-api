// api/amazon/orders.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchAndStoreAmazonOrders } from "../../lib/amazon-orders.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = (req.query.user as string) || "";
  if (!user) return res.status(400).json({ ok: false, error: "missing user" });
  try {
    const orders = await fetchAndStoreAmazonOrders(user);
    res.status(200).json({ ok: true, orders });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
