// lib/__tests__/receipt-dedupe.test.ts
// Assumes jest runs via ts-jest in ESM mode so we can exercise normalization logic; trade-off is
// the extra dev dependency weight to assert canonicalization stays stable for ingestion dedupe keys
// while trusting ingestion to scale totals into minor units before they reach this helper.

import { canonicalizeReceipt, makeDedupeKey } from "../receipt-dedupe.js";

describe("canonicalizeReceipt", () => {
  it("normalizes casing, spacing, and amounts", () => {
    const canonical = canonicalizeReceipt({
      user_id: "user-123 ",
      merchant: "BestBuy.COM",
      order_id: "  ABC-123  ",
      purchase_date: "2024-04-15T12:00:00Z",
      currency: "usd",
      total_cents: " $1,234.56 ",
    });

    expect(canonical).toBe("user-123|bestbuy.com|ABC-123|2024-04-15|USD|123456");
  });

  it("handles zero and three decimal currencies correctly", () => {
    const jpy = canonicalizeReceipt({
      user_id: "user-1",
      merchant: "Rakuten",
      order_id: "JP-1",
      purchase_date: "2024-01-01",
      currency: "jpy",
      total_cents: 5000,
    });

    const bhd = canonicalizeReceipt({
      user_id: "user-1",
      merchant: "Bahrain Shop",
      order_id: "BH-1",
      purchase_date: "2024-01-01",
      currency: "BHD",
      total_cents: 12345,
    });

    expect(jpy.endsWith("|JPY|5000")).toBe(true);
    expect(bhd.endsWith("|BHD|12345")).toBe(true);
  });
});

describe("makeDedupeKey", () => {
  it("produces identical hashes for equivalent receipts", () => {
    const first = makeDedupeKey({
      user_id: "user-abc",
      merchant: "Store",
      order_id: "XYZ",
      purchase_date: "2024-05-01",
      currency: "usd",
      total_cents: "4999",
    });

    const second = makeDedupeKey({
      user_id: " user-abc ",
      merchant: " store ",
      order_id: " XYZ ",
      purchase_date: "2024-05-01T08:00:00-04:00",
      currency: "USD",
      total_cents: 4999,
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});
