// lib/mail.ts
export async function sendMail(
  to: string,
  subject: string,
  text: string
): Promise<void> {
  const token = process.env.POSTMARK_TOKEN!;
  const from = process.env.POSTMARK_FROM!; // e.g. "no-reply@covrily.com"
  if (!token || !from) throw new Error("Missing POSTMARK_TOKEN or POSTMARK_FROM");

  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": token
    },
    body: JSON.stringify({
      From: from,
      To: to,
      Subject: subject,
      TextBody: text,
      MessageStream: "outbound"
    })
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`postmark error ${res.status}: ${msg}`);
  }
}
