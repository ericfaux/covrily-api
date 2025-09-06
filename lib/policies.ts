// lib/policies.ts
export function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Very simple rule to demonstrate deadlines.
 * Treat merchant as either a printable name or a domain.
 * Returns a Date or null.
 */
export function computeReturnDeadline(merchant: string, purchaseDate: string) {
  const m = (merchant || "").toLowerCase();
  const isBestBuy = m.includes("best buy") || m.includes("bestbuy.com") || m.includes("bestbuy");
  if (isBestBuy) return addDays(new Date(purchaseDate), 15);
  return null;
}
