// lib/pdf.ts
// Minimal H&M PDF parser. Parses a PDF Buffer and extracts a few fields.
// IMPORTANT: loads the CJS library "pdf-parse" via createRequire to avoid its CLI self-test running.

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse: (buf: Buffer) => Promise<{ text: string; numpages: number }> = require("pdf-parse");

// ----- utilities -----
function toCents(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[,\s]/g, ""));
  if (!isFinite(n)) return null;
  return Math.round(n * 100);
}

function isoFromDayMonthYear(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);        // e.g. "25 July 2022"
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
  pages?: number;
  text_excerpt?: string;
  line_items?: Array<{ desc: string; unit_cents?: number; qty?: number; total_cents?: number }>;
};

/**
 * Parse an H&M-style PDF that contains selectable text (like your example).
 * Never reads local files; only consumes the provided Buffer/typed array.
 */
export default async function parseHmPdf(
  input: Buffer | Uint8Array | ArrayBuffer
): Promise<PdfIngestPreview> {
  // Normalize to a Node Buffer
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input as any);

  const parsed = await pdfParse(buf);
  const text = (parsed.text || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();

  // Heuristic fields
  const mOrder         = text.match(/ORDER NUMBER\s+([A-Z0-9\-]+)/i);
  const mReceipt       = text.match(/RECEIPT NUMBER\s+([A-Z0-9\-]+)/i);
  const mReceiptDate   = text.match(/RECEIPT DATE\s+(\d{1,2} [A-Za-z]+ \d{4})/i);
  const mOrderDate     = text.match(/ORDER DATE\s+(\d{1,2} [A-Za-z]+ \d{4})/i);
  const mTotal         = text.match(/TOTAL[: ]+\$?\s*([0-9]+(?:\.[0-9]{2})?)/i);

  // Very light line-item grab (optional)
  const lineItems: Array<{ desc: string; unit_cents?: number; qty?: number; total_cents?: number }> = [];
  const itemRegex = /([A-Za-z0-9\- ]+Polo Shirt[A-Za-z0-9\- ]*)[^$]*\$([0-9]+\.[0-9]{2})/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(text)) !== null) {
    lineItems.push({
      desc: m[1].trim(),
      unit_cents: toCents(m[2]) ?? undefined,
      qty: 1,
      total_cents: toCents(m[2]) ?? undefined,
    });
  }

  return {
    ok: true,
    merchant: "hm.com",
    order_number:   mOrder?.[1] ?? null,
    receipt_number: mReceipt?.[1] ?? null,
    order_date:     isoFromDayMonthYear(mOrderDate?.[1] ?? null),
    receipt_date:   isoFromDayMonthYear(mReceiptDate?.[1] ?? null),
    total_cents:    toCents(mTotal?.[1] ?? null),
    pages:          parsed.numpages,
    text_excerpt:   text.slice(0, 800),
    line_items:     lineItems.length ? lineItems : undefined,
  };
}
