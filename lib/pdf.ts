// lib/pdf.ts
import pdfParse from "pdf-parse";

/** Dollars (string/number) -> cents (integer) */
function toCents(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[, ]/g, ""));
  if (!isFinite(n)) return null;
  return Math.round(n * 100);
}

/** "25 July 2022" -> ISO string or null */
function isoFromDayMonthYear(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export type PdfIngestPreview = {
  ok: boolean;
  merchant: string | null;
  order_number: string | null;
  receipt_number: string | null;
  order_date: string | null;    // ISO
  receipt_date: string | null;  // ISO
  total_cents: number | null;
  tax_cents?: number | null;
  shipping_cents?: number | null;
  pages?: number;
  text_excerpt?: string;
};

/**
 * Minimal H&M PDF parser — works for text‑extractable PDFs like your example.
 * IMPORTANT: always pass a Buffer/Uint8Array. Never a file path.
 */
export default async function parseHmPdf(
  input: Buffer | Uint8Array | ArrayBuffer
): Promise<PdfIngestPreview> {

  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input as any);
  const parsed = await pdfParse(buf);
  const text = (parsed.text || "").replace(/\r/g, "");
  const t = text.replace(/[ \t]+/g, " ").trim();

  // Basic fields
  const mOrder   = t.match(/ORDER NUMBER\s+([A-Z0-9\-]+)/i);
  const mReceipt = t.match(/RECEIPT NUMBER\s+([A-Z0-9\-]+)/i);
  const mRcvDate = t.match(/RECEIPT DATE\s+(\d{1,2} [A-Za-z]+ \d{4})/i);
  const mOrdDate = t.match(/ORDER DATE\s+(\d{1,2} [A-Za-z]+ \d{4})/i);

  // Totals
  const mTotal   = t.match(/TOTAL[: ]+\$?\s*([0-9]+(?:\.[0-9]{2})?)/i);
  const mTax     = t.match(/SALES TAX[: ]+\$?\s*([0-9]+(?:\.[0-9]{2})?)/i);
  const mShip    = t.match(/SHIPPING(?: & HANDLING)?[: ]+\$?\s*([A-Z]+|[0-9]+(?:\.[0-9]{2})?)/i);

  const total_cents    = toCents(mTotal?.[1] ?? null);
  const tax_cents      = toCents(mTax?.[1] ?? null);
  const shipping_cents =
    mShip?.[1] && /^[A-Z]+$/.test(mShip[1]) ? 0 : toCents(mShip?.[1] ?? null);

  return {
    ok: true,
    merchant: "hm.com",
    order_number:  mOrder?.[1] ?? null,
    receipt_number: mReceipt?.[1] ?? null,
    order_date:    isoFromDayMonthYear(mOrdDate?.[1] ?? null),
    receipt_date:  isoFromDayMonthYear(mRcvDate?.[1] ?? null),
    total_cents,
    tax_cents,
    shipping_cents,
    pages: parsed.numpages,
    text_excerpt: t.slice(0, 800)
  };
}
