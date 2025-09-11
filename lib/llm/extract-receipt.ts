// lib/llm/extract-receipt.ts
import type { ParsedReceipt } from "../parse.js";

interface LlmRawResponse {
  merchant?: string;
  order_id?: string;
  purchase_date?: string;
  total_cents?: number | string;
  total?: number | string;
}

export default async function extractReceipt(text: string): Promise<ParsedReceipt | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const messages = [
    { role: "system", content: "Extract merchant domain, order_id, purchase_date, and total_cents (integer) from the receipt text. Respond with JSON." },
    { role: "user", content: "Best Buy order confirmation\nOrder #BB123\nTotal: $45.67\nDate: Jan 5, 2024" },
    { role: "assistant", content: '{"merchant":"bestbuy.com","order_id":"BB123","purchase_date":"Jan 5, 2024","total_cents":4567}' },
    { role: "user", content: "Target receipt\nOrder: 78910\nPurchase Date: 2024-05-01\nAmount: $15.99" },
    { role: "assistant", content: '{"merchant":"target.com","order_id":"78910","purchase_date":"2024-05-01","total_cents":1599}' },
    { role: "user", content: text }
  ];

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_RECEIPT_MODEL || "gpt-4o-mini",
        temperature: 0,
        messages
      })
    });

    const data = await resp.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    const cleaned = content.replace(/```json|```/g, "").trim();
    const raw = JSON.parse(cleaned) as LlmRawResponse;

    let total = raw.total_cents ?? raw.total;
    let total_cents: number | null = null;
    if (typeof total === "number") total_cents = Math.round(total);
    else if (typeof total === "string") {
      const n = parseFloat(total.replace(/[, ]/g, ""));
      total_cents = isFinite(n) ? Math.round(n * (raw.total_cents != null ? 1 : 100)) : null;
    }

    return {
      merchant: raw.merchant ? raw.merchant.toLowerCase() : "unknown",
      order_id: raw.order_id || null,
      purchase_date: raw.purchase_date || null,
      total_cents
    };
  } catch (e) {
    console.warn("[llm] extractReceipt failed:", e);
    return null;
  }
}

