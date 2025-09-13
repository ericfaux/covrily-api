import { load } from "cheerio";
import { supabaseAdmin } from "./supabase-admin.js";

export interface AmazonOrder {
  orderId: string;
  returnHtml: string;
  returnEligibleAt: string | null;
}

async function fetchOrderPage(cookie: string, startIndex = 0): Promise<string> {
  const url = `https://www.amazon.com/gp/css/order-history?digitalOrders=0&unifiedOrders=1&startIndex=${startIndex}`;
  const res = await fetch(url, {
    headers: {
      cookie,
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`order history fetch failed: ${res.status}`);
  return res.text();
}

function parseOrders(html: string): AmazonOrder[] {
  const $ = load(html);
  const orders: AmazonOrder[] = [];
  $("div[data-order-id]").each((_, el) => {
    const orderId = $(el).attr("data-order-id") || "";
    const retEl = $(el).find(':contains("Eligible through")').first();
    const returnHtml = retEl.html() || "";
    const text = retEl.text();
    let returnEligibleAt: string | null = null;
    const m = text.match(/Eligible through\s*(.+)/i);
    if (m) {
      const parsed = new Date(m[1]);
      if (!isNaN(parsed.getTime())) returnEligibleAt = parsed.toISOString();
    }
    orders.push({ orderId, returnHtml, returnEligibleAt });
  });
  return orders;
}

export async function fetchAndStoreAmazonOrders(userId: string): Promise<AmazonOrder[]> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("amazon_order_cookies")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data || !data.amazon_order_cookies) throw new Error("missing amazon cookies");
  const cookie = data.amazon_order_cookies as string;

  let startIndex = 0;
  const allOrders: AmazonOrder[] = [];
  while (true) {
    const html = await fetchOrderPage(cookie, startIndex);
    const orders = parseOrders(html);
    if (orders.length === 0) break;
    allOrders.push(...orders);
    startIndex += orders.length;
  }

  if (allOrders.length > 0) {
    const rows = allOrders.map((o) => ({
      user_id: userId,
      order_id: o.orderId,
      return_html: o.returnHtml,
      return_eligible_at: o.returnEligibleAt,
    }));
    await supabaseAdmin.from("amazon_orders").upsert(rows, {
      onConflict: "user_id,order_id",
    });
  }
  return allOrders;
}
