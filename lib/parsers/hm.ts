import pdfParse from "pdf-parse/lib/pdf-parse.js";
import type { ParsedReceipt } from "../parse.js";

function toCents(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[, ]/g, ""));
  if (!isFinite(n)) return null;
  return Math.round(n * 100);
}

function isoFromDayMonthYear(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export async function parse(buf: Buffer): Promise<ParsedReceipt> {
  const parsed = await pdfParse(buf);
  const text = (parsed.text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

  const mOrder = text.match(/ORDER NUMBER\s+([A-Z0-9\-]+)/i);
  const mOrderDate = text.match(/ORDER DATE\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
  const mTotal = text.match(/TOTAL[: ]+\$?\s*([0-9]+(?:\.[0-9]{2})?)/i);

  return {
    merchant: "hm.com",
    order_id: mOrder?.[1] ?? null,
    purchase_date: isoFromDayMonthYear(mOrderDate?.[1] ?? null),
    total_cents: toCents(mTotal?.[1] ?? null)
  };
}
