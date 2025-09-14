// api/gmail/ingest.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { gmailClientForUser } from "../../lib/gmail-scan.js";
import { listAuthorizedMerchants } from "../../lib/merchants.js";
import parsePdf from "../../lib/pdf.js";
import { supabaseAdmin } from "../../lib/supabase-admin.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = (req.query.user as string) || "";
  if (!user) return res.status(400).json({ ok: false, error: "missing user" });

  try {
    const gmail = await gmailClientForUser(user);
    const merchants = await listAuthorizedMerchants(user);
    for (const merchant of merchants) {
      const list = await gmail.users.messages.list({
        userId: "me",
        q: `from:${merchant}`,
        maxResults: 10,
      });
      for (const m of list.data.messages ?? []) {
        const msg = await gmail.users.messages.get({ userId: "me", id: m.id!, format: "full" });
        const parts = msg.data.payload?.parts ?? [];
        for (const p of parts) {
          if (!p.filename?.toLowerCase().endsWith(".pdf")) continue;
          const attachId = p.body?.attachmentId;
          if (!attachId) continue;
          const att = await gmail.users.messages.attachments.get({
            userId: "me",
            messageId: msg.data.id!,
            id: attachId,
          });
          const buf = Buffer.from(att.data.data || "", "base64");
          const parsed = await parsePdf(buf);
          const purchase_date = parsed.purchase_date || new Date().toISOString();
          await supabaseAdmin
            .from("receipts")
            .insert({
              user_id: user,
              merchant: parsed.merchant ?? merchant,
              order_id: parsed.order_id ?? null,
              total_cents: parsed.total_cents ?? null,
              purchase_date: purchase_date,
            });
        }
      }
    }
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
}
