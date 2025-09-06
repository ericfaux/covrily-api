// api/dev/send-test.ts
import { sendEmail } from "../../lib/postmark";

export default async function handler(req: any, res: any) {
  const to = (req.query?.to as string) || process.env.EMAIL_FROM;
  const subject = "Covrily: Postmark send test";
  const body = "If you received this, domain sending is configured.";

  const result = await sendEmail(to!, subject, body);
  return res.status(200).json({ ok: true, result });
}
