import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { naiveParse, ParsedReceipt } from "../parse.js";

export async function parse(buf: Buffer): Promise<ParsedReceipt> {
  const parsed = await pdfParse(buf);
  const text = (parsed.text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

  const base = naiveParse(text, "");
  return { ...base, merchant: "walmart.com" };
}
