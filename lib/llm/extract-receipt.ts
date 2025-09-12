// lib/llm/extract-receipt.ts
import type { ParsedReceipt } from "../parse.js";

export interface LlmReceipt extends ParsedReceipt {
  tax_cents?: number | null;
  shipping_cents?: number | null;
}

interface LlmRawResponse {
  merchant?: string;
  order_id?: string;
  purchase_date?: string;
  total_cents?: number | string;
  total?: number | string;
  tax_cents?: number | string;
  tax?: number | string;
  shipping_cents?: number | string;
  shipping?: number | string;
}

export default async function extractReceipt(text: string): Promise<LlmReceipt | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const messages = [
    {
      role: "system",
      content:
        "Extract merchant domain, order_id (also called confirmation or receipt number), purchase_date, total_cents, tax_cents, and shipping_cents as integers from the receipt text. Respond with JSON."
    },
    {
      role: "user",
      content:
        "CubeSmart receipt\nConfirmation number: 6179830239\nAmount: $66.77\nDate: Apr 26, 2024"
    },
    {
      role: "assistant",
      content:
        '{"merchant":"cubesmart.com","order_id":"6179830239","purchase_date":"Apr 26, 2024","total_cents":6677}'
    },
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

    const toCents = (
      v: number | string | undefined,
      alreadyCents: boolean
    ): number | null => {
      if (typeof v === "number") return Math.round(alreadyCents ? v : v * 100);
      if (typeof v === "string") {
        const n = parseFloat(v.replace(/[, ]/g, ""));
        if (!isFinite(n)) return null;
        return Math.round(n * (alreadyCents ? 1 : 100));
      }
      return null;
    };

    const total_cents = toCents(raw.total_cents ?? raw.total, raw.total_cents != null);
    const tax_cents = toCents(raw.tax_cents ?? raw.tax, raw.tax_cents != null);
    const shipping_cents = toCents(
      raw.shipping_cents ?? raw.shipping,
      raw.shipping_cents != null
    );

    return {
      merchant: raw.merchant ? raw.merchant.toLowerCase() : "unknown",
      order_id: raw.order_id || null,
      purchase_date: raw.purchase_date || null,
      total_cents,
      tax_cents,
      shipping_cents
    };
  } catch (e) {
    console.warn("[llm] extractReceipt failed:", e);
    return null;
  }
}

