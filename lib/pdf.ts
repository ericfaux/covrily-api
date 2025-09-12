import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { naiveParse, ParsedReceipt } from "./parse.js";
import { parse as parseHm } from "./parsers/hm.js";
import { parse as parseBestBuy } from "./parsers/bestbuy.js";
import { parse as parseWalmart } from "./parsers/walmart.js";

export type ParsedPdf = ParsedReceipt & { text_excerpt: string };

export default async function parsePdf(buf: Buffer): Promise<ParsedPdf> {
  if (!buf) throw new Error("empty pdf buffer");
  const parsed = await pdfParse(buf);
  const text = (parsed.text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
  const lower = text.toLowerCase();

  let base: ParsedReceipt;
  if (lower.includes("h&m") || lower.includes("hm.com")) {
    base = await parseHm(buf);
  } else if (lower.includes("best buy") || lower.includes("bestbuy.com")) {
    base = await parseBestBuy(buf);
  } else if (lower.includes("walmart")) {
    base = await parseWalmart(buf);
  } else {
    base = naiveParse(text, "");
    const merchant =
      /best ?buy/.test(lower) ? "bestbuy.com" :
      /target/.test(lower)   ? "target.com"   :
      /walmart/.test(lower)  ? "walmart.com"  :
      /amazon/.test(lower)   ? "amazon.com"   :
      /hm\.?com|h&m/.test(lower) ? "hm.com"   :
      "unknown";
    base.merchant = merchant;
  }

  return { ...base, text_excerpt: text.slice(0, 5000) };
}
