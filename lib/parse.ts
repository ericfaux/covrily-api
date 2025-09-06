export type ParsedReceipt = {
  merchant: string;
  order_id?: string | null;
  purchase_date?: string | null; // YYYY-MM-DD or "Jan 2, 2025" accepted
  total_cents?: number | null;
};

export function naiveParse(text: string, fromEmail: string): ParsedReceipt {
  // merchant guess from sender domain (fallback)
  const merchant = fromEmail.split("@")[1]?.split(">")[0]?.trim() || "unknown";

  const orderMatch = text.match(/Order\s?#\s?([0-9\-]+)/i);
  const dateMatch = text.match(
    /(?:Date|Ordered on|Purchase Date):?\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}|\d{4}-\d{2}-\d{2})/
  );
  const totalMatch = text.match(/\$([\d,]+\.\d{2})/);

  const toCents = (s?: string) =>
    s ? Math.round(parseFloat(s.replace(/,/g, "")) * 100) : null;

  return {
    merchant,
    order_id: orderMatch?.[1] ?? null,
    purchase_date: dateMatch?.[1] ?? null,
    total_cents: toCents(totalMatch?.[1]) ?? null
  };
}
