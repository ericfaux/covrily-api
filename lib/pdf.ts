// lib/pdf.ts
import pdfParse from "pdf-parse";

/** dollars string -> cents (integer) */
function toCents(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** "25 July 2022" -> ISO date string (or null) */
function isoFromDayMonthYear(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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
 * Minimal H&M PDF parser.
 * - Always pass a Buffer/Uint8Array/ArrayBuffer (NOT a path string).
 * - Returns a lightweight preview (we only need a few fields for upsert).
 */
export default async function parseHmPdf(
  input: Buffer | Uint8Array | ArrayBuffer
): Promise<PdfIngestPreview> {
  // Normalize to Node Buffer so pdf-parse never interprets it as a path
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input as any);

  const parsed = await pdfParse(buf);
  const raw = (parsed.text || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();

  // Heuristics for a few fields
  const mOrder       = raw.match(/ORDER NUMBER\s+([A-Z0-9\-]+)/i);
  const mReceipt     = raw.match(/RECEIPT NUMBER\s+([A-Z0-9\-]+)/i);
  const mReceiptDate = raw.match(/RECEIPT DATE\s+(\d{1,2} [A-Za-z]+ \d{4})/i);
  const mOrderDate   = raw.match(/ORDER DATE\s+(\d{1,2} [A-Za-z]+ \d{4})/i);
  const mTotal       = raw.match(/TOTAL[: ]+\$?\s*([0-9]+(?:\.[0-9]{2})?)/i);
  const mTax         = raw.match(/(SALES\s+TAX|TAX)[: ]+\$?\s*([0-9]+(?:\.[0-9]{2})?)/i);
  const mShip        = raw.match(/(SHIPPING(?: & HANDLING)?)[: ]+\$?\s*([0-9]+(?:\.[0-9]{2})?)/i);

  return {
    ok: true,
    merchant: "hm.com",
    order_number:   mOrder?.[1] ?? null,
    receipt_number: mReceipt?.[1] ?? null,
    order_date:     isoFromDayMonthYear(mOrderDate?.[1] ?? null),
    receipt_date:   isoFromDayMonthYear(mReceiptDate?.[1] ?? null),
    total_cents:    toCents(mTotal?.[1] ?? null),
    tax_cents:      toCents(mTax?.[2] ?? null),
    shipping_cents: toCents(mShip?.[2] ?? null),
    pages: parsed.numpages,
    text_excerpt: raw.slice(0, 800)
  };
}
