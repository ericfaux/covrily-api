// lib/pdf.ts
import pdfParse from "pdf-parse";

// Utility: dollars string -> cents (integer)
function toCents(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[, ]/g, ""));
  if (!isFinite(n)) return null;
  return Math.round(n * 100);
}

// Utility: parse "25 July 2022" style into Date
function parseDayMonthYear(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s); // JS can parse "25 July 2022"
  return isNaN(d.getTime()) ? null : d;
}

export type PdfIngestPreview = {
  ok: boolean;
  merchant: string | null;
  order_number: string | null;
  receipt_number: string | null;
  order_date: string | null;    // ISO
  receipt_date: string | null;  // ISO
  total_cents: number | null;
  line_items?: Array<{ desc: string; unit_cents?: number; qty?: number; total_cents?: number }>;
  pages?: number;
  text_excerpt?: string;
};

// Very lightweight H&M parser (works on text-extractable PDFs like your screenshot)
export async function parseHmPdf(buffer: Buffer): Promise<PdfIngestPreview> {
  const parsed = await pdfParse(buffer);
  const text = parsed.text || "";

  // Cheap line normalization
  const t = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();

  // Heuristics for the fields we care about
  const mOrder = t.match(/ORDER NUMBER\s+([A-Z0-9\-]+)/i);
  const mReceipt = t.match(/RECEIPT NUMBER\s+([A-Z0-9\-]+)/i);

  // Dates like "25 July 2022"
  const mReceiptDate = t.match(/RECEIPT DATE\s+(\d{1,2} [A-Za-z]+ \d{4})/i);
  const mOrderDate   = t.match(/ORDER DATE\s+(\d{1,2} [A-Za-z]+ \d{4})/i);

  // TOTAL: $68.33  (allow optional $)
  const mTotal = t.match(/TOTAL[: ]+\$?\s*([0-9]+(?:\.[0-9]{2})?)/i);

  // Line items (very rough; optional)
  const lines: Array<{ desc: string; unit_cents?: number; qty?: number; total_cents?: number }> = [];
  // Example pattern "... Slim Fit Polo Shirt ... 1 $12.99 ... $12.99" -> capture description and price
  const itemRegex = /([A-Za-z0-9\- ]+Polo Shirt[A-Za-z0-9\- ]*)[^$]*\$([0-9]+\.[0-9]{2})/gi;
  let m;
  while ((m = itemRegex.exec(t)) !== null) {
    lines.push({ desc: m[1].trim(), unit_cents: toCents(m[2]) ?? undefined, qty: 1, total_cents: toCents(m[2]) ?? undefined });
  }

  const order_number = mOrder?.[1] ?? null;
  const receipt_number = mReceipt?.[1] ?? null;
  const order_date = parseDayMonthYear(mOrderDate?.[1] ?? null)?.toISOString() ?? null;
  const receipt_date = parseDayMonthYear(mReceiptDate?.[1] ?? null)?.toISOString() ?? null;
  const total_cents = toCents(mTotal?.[1] ?? null);

  return {
    ok: true,
    merchant: "hm.com",
    order_number,
    receipt_number,
    order_date,
    receipt_date,
    total_cents,
    line_items: lines.length ? lines : undefined,
    pages: parsed.numpages,
    text_excerpt: t.slice(0, 800)
  };
}
