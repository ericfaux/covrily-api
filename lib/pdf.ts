// lib/pdf.ts

// ——— Utilities ———
function toCents(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[, ]/g, ""));
  if (!isFinite(n)) return null;
  return Math.round(n * 100);
}

function parseDayMonthYear(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s); // JS can parse "25 July 2022"
  return isNaN(d.getTime()) ? null : d;
}

export type PdfIngestPreview = {
  ok: boolean;
  merchant: string | null;
  order_number: string | null;
  receipt_number: string | null;
  order_date: string | null;   // ISO
  receipt_date: string | null; // ISO
  total_cents: number | null;
  line_items?: Array<{ desc: string; unit_cents?: number; qty?: number; total_cents?: number }>;
  pages?: number;
  text_excerpt?: string;
};

/**
 * Minimal H&M PDF parser.
 * Works for text-extractable PDFs like the one in your screenshot.
 * You can tighten the regexes as we see more samples.
 */
export default async function parseHmPdf(
  input: Buffer | Uint8Array | ArrayBuffer
): Promise<PdfIngestPreview> {
  // Lazy/dynamic import so CJS/ESM interop is stable on Vercel
  const mod = await import("pdf-parse");
  const pdfParse: (b: Buffer) => Promise<{ text: string; numpages?: number }> =
    (mod as any).default ?? (mod as any);

  const buf = Buffer.isBuffer(input)
    ? input
    : Buffer.from(input instanceof ArrayBuffer ? new Uint8Array(input) : input);

  const parsed = await pdfParse(buf);
  const text = parsed.text || "";

  // Normalize: remove CRs, collapse whitespace a bit
  const t = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();

  // Heuristics
  const mOrder = t.match(/ORDER NUMBER\s+([A-Z0-9\-]+)/i);
  const mReceipt = t.match(/RECEIPT NUMBER\s+([A-Z0-9\-]+)/i);

  const mReceiptDate = t.match(/RECEIPT DATE\s+(\d{1,2} [A-Za-z]+ \d{4})/i);
  const mOrderDate   = t.match(/ORDER DATE\s+(\d{1,2} [A-Za-z]+ \d{4})/i);

  // TOTAL: $68.33  (allow optional $)
  const mTotal = t.match(/TOTAL[: ]+\$?\s*([0-9]+(?:\.[0-9]{2})?)/i);

  // Optional: super-light line item capture example
  const lines: Array<{ desc: string; unit_cents?: number; qty?: number; total_cents?: number }> = [];
  const itemRegex = /([A-Za-z0-9\- ]+?Shirt[A-Za-z0-9\- ]*)[^$]*\$([0-9]+\.[0-9]{2})/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(t)) !== null) {
    lines.push({
      desc: m[1].trim(),
      unit_cents: toCents(m[2]) ?? undefined,
      qty: 1,
      total_cents: toCents(m[2]) ?? undefined,
    });
  }

  const order_number = mOrder?.[1] ?? null;
  const receipt_number = mReceipt?.[1] ?? null;
  const order_date = parseDayMonthYear(mOrderDate?.[1])?.toISOString() ?? null;
  const receipt_date = parseDayMonthYear(mReceiptDate?.[1])?.toISOString() ?? null;
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
    pages: (parsed as any).numpages ?? undefined,
    text_excerpt: t.slice(0, 800),
  };
}
