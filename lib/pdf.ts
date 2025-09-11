// lib/pdf.ts
import pdfParse from "pdf-parse/lib/pdf-parse.js";

/** dollars string -> cents (integer) */
function toCents(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n =
    typeof v === "number" ? v : parseFloat(String(v).replace(/[, ]/g, ""));
  if (!isFinite(n)) return null;
  return Math.round(n * 100);
}

/** "25 July 2022" -> ISO date string (or null) */
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
 * Minimal H&M PDF parser.
 * - Always pass a Buffer/Uint8Array/ArrayBuffer (NOT a path string).
 * - Returns a lightweight preview (we only need a few fields for upsert).
 */
export default async function parseHmPdf(
  input: Buffer | Uint8Array | ArrayBuffer
): Promise<PdfIngestPreview> {
  // --- normalize to a Node Buffer so pdf-parse never interprets it as a path ---
  let buf: Buffer;
  if (!input) throw new Error("empty pdf buffer");
  if (Buffer.isBuffer(input)) buf = input;
  else if (input instanceof Uint8Array) buf = Buffer.from(input);
  else if (input instanceof ArrayBuffer) buf = Buffer.from(new Uint8Array(input));
  else throw new Error("parseHmPdf requires Buffer/typed array input");

  const parsed = await pdfParse(buf);
  const text = (parsed.text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

  // Heuristics for H&M‑style fields
  const mOrder     = text.match(/ORDER NUMBER\s+([A-Z0-9\-]+)/i);
  const mReceipt   = text.match(/RECEIPT NUMBER\s+([A-Z0-9\-]+)/i);
  const mOrderDate = text.match(/ORDER DATE\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
  const mRcptDate  = text.match(/RECEIPT DATE\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
  const mTotal     = text.match(/TOTAL[: ]+\$?\s*([0-9]+(?:\.[0-9]{2})?)/i);
  const mTax       = text.match(/SALES TAX[: ]+\$?\s*([0-9]+(?:\.[0-9]{2})?)/i);
  const mShip      = text.match(/SHIPPING(?: & HANDLING)?[: ]+\$?\s*([0-9]+(?:\.[0-9]{2})?)/i);

  return {
    ok: true,
    merchant: "hm.com",
    order_number: mOrder?.[1] ?? null,
    receipt_number: mReceipt?.[1] ?? null,
    order_date: isoFromDayMonthYear(mOrderDate?.[1] ?? null),
    receipt_date: isoFromDayMonthYear(mRcptDate?.[1] ?? null),
    total_cents: toCents(mTotal?.[1] ?? null),
    tax_cents: toCents(mTax?.[1] ?? null),
    shipping_cents: toCents(mShip?.[1] ?? null),
    pages: typeof parsed.numpages === "number" ? parsed.numpages : undefined,
    text_excerpt: text.slice(0, 800)
  };
}
