// lib/postmark.ts
// Minimal Postmark sender using fetch. No extra npm packages needed.

export async function sendEmail(to: string, subject: string, text: string) {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const from = process.env.EMAIL_FROM;

  if (!token || !from) {
    console.warn("POSTMARK not configured; skipping send", { to, subject });
    return { skipped: true };
  }

  const resp = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "X-Postmark-Server-Token": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      From: from,
      To: to,
      Subject: subject,
      TextBody: text
    })
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error("POSTMARK_SEND_ERROR", resp.status, body);
    return { ok: false, status: resp.status, body };
  }
  return { ok: true };
}
