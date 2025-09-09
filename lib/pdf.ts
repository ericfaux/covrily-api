// /lib/pdf.ts
import pdfParse from "pdf-parse";

/** dollars -> integer cents (null-safe) */
function toCents(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n =
    typeof v === "number"
      ? v
      : parseFloat(String(v).replace(/[^0-9.]/g, ""));
  if (!isFinite(n)) return null;
  return Math.round(n * 100);
}

/** "25 July 2022" -> ISO string (or null) */
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
  line_items?: Array<{
    desc: string;
    qty?: number;
    unit_cents?: number | null;
    total_cents?: number | null;
    upc?: string;
  }>;
  pages?: number;
  text_excerpt?: string;
};

/**
 * Minimal H&M‑style parser. Works for PDFs where text is extractable
 * (like the screenshot you shared). It intentionally errs on the safe side.
 */
export default async function parseHmPdf(
  input: Buffer | Uint8Array | ArrayBuffer
): Promise<PdfIngestPreview> {
  // Normalize to a Node Buffer
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input as any);
  const parsed = await pdfParse(buf);
  const text = (parsed.text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

  const order_number =
    text.match(/ORDER NUMBER\s+([A-Z0-9\-]+)/i)?.[1] ?? null;
  const receipt_number =
    text.match(/RECEIPT NUMBER\s+([A-Z0-9\-]+)/i)?.[1] ?? null;

  const order_date = isoFromDayMonthYear(
    text.match(/ORDER DATE\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i)?.[1] ?? null
  );
  const receipt_date = isoFromDayMonthYear(
    text.match(/RECEIPT DATE\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i)?.[1] ?? null
  );

  // Totals
  const total_cents = toCents(
    text.match(/TOTAL[: ]+\$?\s*([0-9]+(?:\.[0-9]{2})?)/i)?.[1] ?? null
  );
  const tax_cents = toCents(
    text.match(/SALES TAX[: ]+\$?\s*([0-9]+(?:\.[0-9]{2})?)/i)?.[1] ?? null
  );
  // "FREE" or a dollar amount
  const shippingRaw =
    text.match(/SHIPPING(?: & HANDLING)?:?\s*(FREE|\$?[0-9]+(?:\.[0-9]{2})?)/i)?.[1] ?? null;
  const shipping_cents =
    shippingRaw && /free/i.test(shippingRaw) ? 0 : toCents(shippingRaw);

  // Line items (very simple heuristic for “... Polo Shirt ... $12.99”)
  const line_items: PdfIngestPreview["line_items"] = [];
  // If your descriptions vary, expand the regex or add a small rule set here.
  const itemRe = /([A-Za-z0-9\- ]+(?:Shirt|Pants|Dress|Top|Shorts|Socks|Jeans)[A-Za-z0-9\- ]*)[^\$]*\$([0-9]+\.[0-9]{2})/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(text)) !== null) {
    const desc = m[1].trim();
    const unit = toCents(m[2]);
    // UPC (optional) – sometimes present near line items as 12+ digits
    const upc = desc.match(/\b(\d{12,14})\b/)?.[1];
    line_items.push({
      desc,
      qty: 1,
      unit_cents: unit,
      total_cents: unit,
      upc: upc ?? undefined,
    });
  }

  return {
    ok: true,
    merchant: "hm.com", // brand/domain hint for this parser
    order_number,
    receipt_number,
    order_date,
    receipt_date,
    total_cents,
    tax_cents,
    shipping_cents,
    line_items: line_items.length ? line_items : undefined,
    pages: parsed.numpages,
    text_excerpt: text.slice(0, 1200),
  };
}
