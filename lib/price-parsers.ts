// lib/price-parsers.ts
export type ParseResult = { cents: number | null; excerpt?: string | null };

function toCents(v: string | number): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[, ]/g, ""));
  if (!isFinite(n)) return null;
  return Math.round(n * 100);
}

export function extractPriceCentsFromHtml(url: string, html: string, selector?: string | null): ParseResult {
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })().toLowerCase();

  // 1) JSON-LD or inline JSON "price"
  {
    const m = html.match(/"price"\s*:\s*"?(?<p>\d{1,6}\.\d{2})"?/i);
    if (m?.groups?.p) return { cents: toCents(m.groups.p)!, excerpt: m[0].slice(0, 200) };
  }

  // 2) <meta itemprop="price" content="xxx">
  {
    const m = html.match(/itemprop\s*=\s*["']price["'][^>]*content\s*=\s*["'](?<p>\d{1,6}\.\d{2})["']/i);
    if (m?.groups?.p) return { cents: toCents(m.groups.p)!, excerpt: m[0].slice(0, 200) };
  }

  // 3) Host-specific gentle hints (can expand over time)
  if (host.includes("bestbuy")) {
    const m = html.match(/"priceAmount"\s*:\s*"?(?<p>\d{1,6}\.\d{2})"?/i)
           || html.match(/"currentPrice"\s*:\s*{"(?:[^}]*)?amount"\s*:\s*(?<p>\d{1,6}\.\d{2})/i);
    if (m?.groups?.p) return { cents: toCents(m.groups.p)!, excerpt: m[0].slice(0, 200) };
  }
  if (host.includes("target")) {
    const m = html.match(/"current_retail"\s*:\s*(?<p>\d{1,6}\.\d{2})/i)
           || html.match(/"price"\s*:\s*"?(?<p>\d{1,6}\.\d{2})"?/i);
    if (m?.groups?.p) return { cents: toCents(m.groups.p)!, excerpt: m[0].slice(0, 200) };
  }
  if (host.includes("walmart")) {
    const m = html.match(/"price"\s*:\s*{"?amount"?\s*:\s*(?<p>\d{1,6}\.\d{2})/i)
           || html.match(/"priceAmount"\s*:\s*"?(?<p>\d{1,6}\.\d{2})"?/i);
    if (m?.groups?.p) return { cents: toCents(m.groups.p)!, excerpt: m[0].slice(0, 200) };
  }

  // 4) Generic $xx.xx fallback — choose the smallest plausible price on the page
  const prices = Array.from(html.matchAll(/\$?\s*(\d{1,6}\.\d{2})/g)).map(m => toCents(m[1])!).filter(Boolean);
  if (prices.length) return { cents: Math.min(...prices), excerpt: "$xx.xx pattern" };

  return { cents: null, excerpt: null };
}
