import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { naiveParse, ParsedReceipt } from "./parse.js";
import { parse as parseHm } from "./parsers/hm.js";
import { parse as parseBestBuy } from "./parsers/bestbuy.js";
import { parse as parseWalmart } from "./parsers/walmart.js";

export default async function parsePdf(buf: Buffer): Promise<ParsedReceipt> {
  if (!buf) throw new Error("empty pdf buffer");
  const parsed = await pdfParse(buf);
  const text = (parsed.text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
  const lower = text.toLowerCase();

  if (lower.includes("h&m") || lower.includes("hm.com")) {
    return parseHm(buf);
  }
  if (lower.includes("best buy") || lower.includes("bestbuy.com")) {
    return parseBestBuy(buf);
  }
  if (lower.includes("walmart")) {
    return parseWalmart(buf);
  }

  return naiveParse(text, "");
}
