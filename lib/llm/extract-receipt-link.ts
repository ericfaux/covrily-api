// lib/llm/extract-receipt-link.ts
export interface ReceiptLinkCandidate {
  url: string;
  anchorText?: string;
}

export default async function extractReceiptLink(
  links: ReceiptLinkCandidate[]
): Promise<string | null> {
  if (!Array.isArray(links) || links.length === 0) return null;
  const urls = links.map((link) => link.url);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return urls[0] ?? null;
  try {
    const promptLines = [
      "Choose the URL most likely to lead to a purchase receipt from the following list.",
      "Each candidate includes the anchor/button text from the email.",
      "Respond with the single URL that should be fetched, or 'none' if nothing is relevant.",
      "",
      links
        .map((link, i) => {
          const anchor = link.anchorText?.trim() || "(no anchor text)";
          return `${i + 1}. URL: ${link.url}\n   Anchor: ${anchor}`;
        })
        .join("\n"),
    ];
    const prompt = promptLines.join("\n");
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_RECEIPT_MODEL || "gpt-4o-mini",
        temperature: 0,
        messages: [
          { role: "user", content: prompt }
        ],
        max_tokens: 200
      })
    });
    const data = await resp.json().catch(() => null);
    const answer = data?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) return null;
    const lower = answer.toLowerCase();
    if (lower.includes("none")) return null;
    const found = urls.find((u) => answer.includes(u));
    if (found) return found;
    const urlMatch = answer.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      const match = urls.find((u) => u === urlMatch[0]);
      if (match) return match;
    }
    const indexMatch = answer.match(/\b(\d+)\b/);
    if (indexMatch) {
      const idx = parseInt(indexMatch[1], 10) - 1;
      if (idx >= 0 && idx < urls.length) return urls[idx];
    }
    return urls[0] ?? null;
  } catch {
    return urls[0] ?? null;
  }
}
