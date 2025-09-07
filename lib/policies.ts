// lib/policies.ts
export type MerchantPolicy = {
  merchant_aliases: string[];          // names/domains we might see
  return_window_days: number;          // days after purchase to return
  price_adjust_window_days: number;    // days after purchase to request price adjust
  restocking_fee_pct: number;          // 0–100
  notes?: string;
};

// ---- MVP rules (simplified; refine over time) ----
const POLICIES: MerchantPolicy[] = [
  { merchant_aliases: ["Best Buy", "bestbuy.com", "bestbuy"], return_window_days: 15, price_adjust_window_days: 15, restocking_fee_pct: 0, notes: "Electronics" },
  { merchant_aliases: ["Target", "target.com"],                return_window_days: 90, price_adjust_window_days: 14, restocking_fee_pct: 0 },
  { merchant_aliases: ["Amazon", "amazon.com"],                return_window_days: 30, price_adjust_window_days: 0,  restocking_fee_pct: 0 },
  { merchant_aliases: ["Walmart", "walmart.com"],              return_window_days: 90, price_adjust_window_days: 7,  restocking_fee_pct: 0 },
  { merchant_aliases: ["Home Depot", "homedepot.com"],         return_window_days: 90, price_adjust_window_days: 30, restocking_fee_pct: 0 },
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
