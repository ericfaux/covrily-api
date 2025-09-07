// lib/policies.ts
export type MerchantPolicy = {
  merchant_aliases: string[];          // names we might see in receipts
  return_window_days: number;          // days after purchase to return
  price_adjust_window_days: number;    // days after purchase to request price adjust
  restocking_fee_pct: number;          // estimated restocking fee (0-100) during allowed returns
  notes?: string;
};

// ---- MVP rules (assumptions; not legal advice) ----
// These are simplified defaults so the engine can reason.
// We can refine them and/or move to DB later.
const POLICIES: MerchantPolicy[] = [
  { merchant_aliases: ["Best Buy"], return_window_days: 15, price_adjust_window_days: 15, restocking_fee_pct: 0, notes: "Electronics" },
  { merchant_aliases: ["Target"],   return_window_days: 90, price_adjust_window_days: 14, restocking_fee_pct: 0 },
  // Amazon generally doesn't do post-purchase price adjustments; treat as 0-day for MVP.
  { merchant_aliases: ["Amazon"],   return_window_days: 30, price_adjust_window_days: 0,  restocking_fee_pct: 0 },
];

// Fallback defaults (generic retailer)
const DEFAULT_POLICY: MerchantPolicy = {
  merchant_aliases: ["Default"],
  return_window_days: 30,
  price_adjust_window_days: 14,
  restocking_fee_pct: 0,
};

export function getPolicy(merchantRaw: string | null | undefined): MerchantPolicy {
  const m = (merchantRaw ?? "").trim().toLowerCase();
  if (!m) return DEFAULT_POLICY;
  for (const p of POLICIES) {
    for (const alias of p.merchant_aliases) {
      if (m.includes(alias.toLowerCase())) return p;
    }
  }
  return DEFAULT_POLICY;
}
