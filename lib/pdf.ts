// lib/pdf.ts
import pdfParse from "pdf-parse";

function toCents(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[,\s]/g, ""));
  if (!isFinite(n)) return null;
  return Math.round(n * 100);
}

function isoFromDayMonthYear(s?: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);               // e.g. "25 July 2022"
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export type PdfIngestPreview = {
  ok: boolean;
  merchant: string | null;
  order_number: string | null;
  receipt_number: string | null;
  order_date: string | null;   // ISO
  receipt_date: string | null; // ISO
  total_cents: number | null;
  pages?: number;
  text_excerpt?: string;
  line_items?: Array<{ desc: string; qty?: number; unit_cents?: number; total_cents?: number }>;
};

/**
 * Minimal H&M PDF parser (works for text‑extractable receipts like your example).
 * IMPORTANT: Never reads local files. Always consumes a Buffer/typed array.
 */
export default async function parseHmPdf(
  input: Buffer | Uint8Array | ArrayBuffer
): Promise<PdfIngestPreview> {
  // Normalize to a Node Buffer
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input as any);
  const parsed = await pdfParse(buf);

  const text = (parsed.text || "")
    .replace(/\r/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();

  // Heuristics
  const mOrder        = text.match(/ORDER NUMBER\s+([A-Z0-9\-]+)/i);
  const mReceiptNo    = text.match(/RECEIPT NUMBER\s+([A-Z0-9\-]+)/i);
  const mOrderDate    = text.match(/ORDER DATE\s+(\d{1,2} [A-Za-z]+ \d{4})/i);
  const mReceiptDate  = text.match(/RECEIPT DATE\s+(\d{1,2} [A-Za-z]+ \d{4})/i);
  const mTotal        = text.match(/TOTAL[: ]+\$?\s*([0-9]+(?:\.[0-9]{2})?)/i);

  // Optional line‑items (very rough, keeps UI interesting for now)
  const items: Array<{ desc: string; qty?: number; unit_cents?: number; total_cents?: number }> = [];
  const itemRegex = /([A-Za-z0-9][A-Za-z0-9 .\-']{8,})\s+(\d+)\s*\$([0-9]+\.[0-9]{2})/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(text)) !== null) {
    items.push({
      desc: m[1].trim(),
      qty: parseInt(m[2], 10) || 1,
      unit_cents: toCents(m[3]) ?? undefined,
      total_cents: toCents(m[3]) ?? undefined,
    });
  }

  return {
    ok: true,
    merchant: "hm.com",
    order_number:   mOrder?.[1] ?? null,
    receipt_number: mReceiptNo?.[1] ?? null,
    order_date:     isoFromDayMonthYear(mOrderDate?.[1]),
    receipt_date:   isoFromDayMonthYear(mReceiptDate?.[1]),
    total_cents:    toCents(mTotal?.[1]),
    pages: parsed.numpages,
    text_excerpt: text.slice(0, 800),
    line_items: items.length ? items : undefined,
  };
}
