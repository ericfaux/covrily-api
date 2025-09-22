// lib/receipt-dedupe.ts
// Assumes receipt totals arrive in major currency units so a static decimal map can convert to cents;
// trade-off is expanding the list if we add exotic currencies, but this keeps dedupe keys consistent today.

import { createHash } from "crypto";

export interface ReceiptIdentity {
  user_id: string;
  merchant?: string | null;
  order_id?: string | null;
  purchase_date?: string | null;
  currency?: string | null;
  total_amount?: number | string | null;
}

const ZERO_DECIMAL_CURRENCIES = new Set<string>([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

const THREE_DECIMAL_CURRENCIES = new Set<string>(["BHD", "JOD", "KWD", "OMR", "TND"]);

function resolveCurrencyCode(input?: string | null): string {
  const normalized = (input || "USD").toString().trim().toUpperCase();
  return normalized || "USD";
}

function resolveMultiplier(currency: string): number {
  if (THREE_DECIMAL_CURRENCIES.has(currency)) {
    return 1000;
  }
  if (ZERO_DECIMAL_CURRENCIES.has(currency)) {
    return 1;
  }
  return 100;
}

function normalizeTotalCents(value: number | string | null | undefined, currency: string): number {
  if (value == null) {
    return 0;
  }

  const multiplier = resolveMultiplier(currency);

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * multiplier);
  }

  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.,-]/g, "");
    if (!cleaned) return 0;
    const normalized = cleaned.replace(/,/g, "");
    const parsed = Number.parseFloat(normalized);
    if (!Number.isFinite(parsed)) return 0;
    return Math.round(parsed * multiplier);
  }

  return 0;
}

function normalizeDateToIso(value?: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

export function canonicalizeReceipt(receipt: ReceiptIdentity): string {
  const userId = (receipt.user_id || "").toString().trim();
  const merchant = (receipt.merchant || "").toString().trim().toLowerCase();
  const orderId = (receipt.order_id || "").toString().trim();
  const currency = resolveCurrencyCode(receipt.currency);
  const purchaseDate = normalizeDateToIso(receipt.purchase_date);
  const totalCents = normalizeTotalCents(receipt.total_amount ?? null, currency);

  return `${userId}|${merchant}|${orderId}|${purchaseDate}|${currency}|${totalCents}`;
}

export function makeDedupeKey(receipt: ReceiptIdentity): string {
  const canonical = canonicalizeReceipt(receipt);
  return createHash("sha256").update(canonical).digest("hex");
}
