// lib/receipt-dedupe.ts
// Assumes upstream ingestion already normalizes totals into minor currency units so dedupe keys can
// hash stable values; trade-off is depending on ingestion for currency scaling, but we avoid duplicating
// multiplier logic here and keep canonicalization lightweight for every call site.

import { createHash } from "crypto";

export interface ReceiptIdentity {
  user_id: string;
  merchant?: string | null;
  order_id?: string | null;
  purchase_date?: string | null;
  currency?: string | null;
  total_cents?: number | string | null;
}

function resolveCurrencyCode(input?: string | null): string {
  const normalized = (input || "USD").toString().trim().toUpperCase();
  return normalized || "USD";
}

function normalizeTotalCents(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value);
  }

  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9-]/g, "");
    if (!cleaned) return 0;
    const parsed = Number.parseInt(cleaned, 10);
    if (!Number.isFinite(parsed)) return 0;
    return Math.round(parsed);
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
  const totalCents = normalizeTotalCents(receipt.total_cents ?? null);

  return `${userId}|${merchant}|${orderId}|${purchaseDate}|${currency}|${totalCents}`;
}

export function makeDedupeKey(receipt: ReceiptIdentity): string {
  const canonical = canonicalizeReceipt(receipt);
  return createHash("sha256").update(canonical).digest("hex");
}
