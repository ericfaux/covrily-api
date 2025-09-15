// lib/llm/extract-receipt-link.ts
export default async function extractReceiptLink(urls: string[]): Promise<string | null> {
  if (!Array.isArray(urls) || urls.length === 0) return null;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return urls[0] ?? null;
  try {
    const prompt =
      "Choose the URL most likely to lead to a purchase receipt from the following list. " +
      "Respond with the single URL or 'none' if none seem like receipts.\n" +
      urls.map((u, i) => `${i + 1}. ${u}`).join("\n");
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
    const found = urls.find((u) => answer.includes(u));
    if (found) return found;
    return null;
  } catch {
    return urls[0] ?? null;
  }
}
