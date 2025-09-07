// lib/decision-engine.ts
import { getPolicy, type MerchantPolicy } from "./policies";

export type ReceiptLite = {
  merchant: string | null;
  purchase_date: string | null;
  total_cents: number | null;
};

export type DecisionPreview = {
  policy: MerchantPolicy;
  purchase_at?: string;
  now: string;
  totals: { purchase_cents?: number; current_cents?: number | null; savings_cents?: number | null };
  windows: {
    return_end_at?: string | null;
    price_adjust_end_at?: string | null;
    days_left_return?: number | null;
    days_left_adjust?: number | null;
  };
  suggestion:
    | "keep"
    | "return_free"
    | "return_w_fee"
    | "price_adjust"
    | "unknown";
  restocking_fee_estimate_cents?: number | null;
  reason?: string;
};

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}
function daysBetween(a: Date, b: Date) {
  return Math.ceil((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
}

export function previewDecision(
  receipt: ReceiptLite,
  now = new Date(),
  opts?: { current_price_cents?: number | null }
): DecisionPreview {
  const nowISO = now.toISOString();
  const policy = getPolicy(receipt.merchant);
  if (!receipt.purchase_date || !receipt.total_cents || receipt.total_cents <= 0) {
    return { policy, now: nowISO, totals: {}, windows: {}, suggestion: "unknown", reason: "Missing purchase_date or total" };
  }

  const purchase = new Date(receipt.purchase_date);
  if (Number.isNaN(purchase.getTime())) {
    return { policy, now: nowISO, totals: {}, windows: {}, suggestion: "unknown", reason: "Invalid purchase_date" };
  }

  const returnEnd = addDays(purchase, policy.return_window_days);
  const adjustEnd = policy.price_adjust_window_days > 0 ? addDays(purchase, policy.price_adjust_window_days) : null;

  const withinReturn = now <= returnEnd;
  const withinAdjust = adjustEnd ? now <= adjustEnd : false;

  const current = opts?.current_price_cents ?? null;
  const purchaseCents = receipt.total_cents!;
  const minSavings = Math.max(200, Math.round(purchaseCents * 0.02)); // $2 or 2%
  const savings = current != null ? Math.max(0, purchaseCents - current) : null;

  let suggestion: DecisionPreview["suggestion"] = "keep";
  let reason = "No better option detected";
  let restockingFee: number | null = null;

  if (withinAdjust && current != null && savings! >= minSavings) {
    suggestion = "price_adjust";
    reason = `Price dropped by $${(savings! / 100).toFixed(2)} within ${policy.price_adjust_window_days} days`;
  } else if (withinReturn) {
    if (policy.restocking_fee_pct > 0) {
      suggestion = "return_w_fee";
      restockingFee = Math.round((policy.restocking_fee_pct / 100) * purchaseCents);
      reason = `Return possible with ~${policy.restocking_fee_pct}% restocking fee`;
    } else {
      suggestion = "return_free";
      reason = "Return window still open";
    }
  } else {
    suggestion = "keep";
    reason = "Windows closed";
  }

  return {
    policy,
    purchase_at: purchase.toISOString(),
    now: nowISO,
    totals: { purchase_cents: purchaseCents, current_cents: current, savings_cents: savings },
    windows: {
      return_end_at: returnEnd.toISOString(),
      price_adjust_end_at: adjustEnd?.toISOString() ?? null,
      days_left_return: withinReturn ? daysBetween(returnEnd, now) : 0,
      days_left_adjust: withinAdjust && adjustEnd ? daysBetween(adjustEnd, now) : 0,
    },
    suggestion,
    restocking_fee_estimate_cents: restockingFee,
    reason,
  };
}
