// lib/amazon-orders.ts
import * as cheerio from "cheerio";
import { supabaseAdmin } from "./supabase-admin.js";

export interface AmazonOrder {
  orderId: string;
  orderDate: string;
  orderUrl: string;
  invoiceUrl: string;
  pdfUrl?: string;
  totalAmount: string;
  productNameShort: string;
}

export function parseOrders(html: string): AmazonOrder[] {
  const $ = cheerio.load(html);
  const orders: AmazonOrder[] = [];

  // Attempt to locate order containers; fall back to generic selectors
  $(".order, .order-card").each((_, el) => {
    const element = $(el);
    const orderId =
      element.find("[data-test-id='order-id'], .order-id, .a-link-normal[href*='orderID']").first().text().trim() ||
      element.attr("data-order-id") ||
      "";
    const orderDate =
      element.find(".order-date, [data-test-id='order-date']").first().text().trim();
    const orderUrl =
      element.find(".order-id a, a[href*='order-details']").attr("href") || "";
    const invoiceUrl = element.find("a:contains('Invoice')").attr("href") || "";

    const totalAmount =
      element
        .find(".order-total, .grand-total-price, [data-test-id='order-total']")
        .first()
        .text()
        .trim();

    const productTitle =
      element
        .find(".product-title, .a-link-normal[href*='product'], [data-test-id='item-title']")
        .first()
        .text()
        .trim();
    const productNameShort = productTitle.split(/\s+/).slice(0, 3).join(" ");

    orders.push({
      orderId,
      orderDate,
      orderUrl,
      invoiceUrl,
      totalAmount,
      productNameShort,
    });
  });

  return orders;
}

export async function fetchAndStoreAmazonOrders(
  userId: string,
  html: string
): Promise<AmazonOrder[]> {
  const orders = parseOrders(html);
  if (!orders.length) return [];

  const payload = orders.map((o) => ({
    user_id: userId,
    order_id: o.orderId,
    order_date: o.orderDate,
    order_url: o.orderUrl,
    invoice_url: o.invoiceUrl,
    pdf_url: o.pdfUrl ?? null,
    total_amount: o.totalAmount,
    product_name_short: o.productNameShort,
  }));

  const { error } = await supabaseAdmin
    .from("amazon_orders")
    .upsert(payload, { onConflict: "order_id" });

  if (error) throw error;
  return orders;
}

