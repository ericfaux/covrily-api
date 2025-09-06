// lib/mail.ts
type MailOpts = {
  headers?: Record<string, string>;
  debugRouteTo?: string | null; // when set, appends a debug line to body
};

export async function sendMail(
  to: string,
  subject: string,
  text: string,
  opts?: MailOpts
): Promise<void> {
  const token = process.env.POSTMARK_TOKEN!;
  const from = process.env.POSTMARK_FROM!;
  if (!token || !from) throw new Error("Missing POSTMARK_TOKEN or POSTMARK_FROM");
  if (!to) throw new Error("Missing recipient address");

  const debug = (process.env.DEBUG_EMAIL_ROUTING === "true" && opts?.debugRouteTo)
    ? `\n\n---\nDEBUG: routed to ${opts.debugRouteTo}`
    : "";

  const payload: any = {
    From: from,
    To: to,
    Subject: subject,
    TextBody: text + debug,
    MessageStream: "outbound"
  };

  if (opts?.headers) {
    payload.Headers = Object.entries(opts.headers).map(([Name, Value]) => ({ Name, Value }));
  }

  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": token
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`postmark error ${res.status}: ${msg}`);
  }
}
