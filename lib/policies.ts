export function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// MVP rule: Best Buy return = 15 days (demo). Unknown merchants return null.
export function computeReturnDeadline(merchant: string, purchaseDate: string) {
  if (merchant.toLowerCase().includes("best buy")) {
    return addDays(new Date(purchaseDate), 15);
  }
  return null;
}
