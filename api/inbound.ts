// api/inbound.ts
// Postmark Inbound webhook handler (idempotent, defensive).
// - GET/HEAD return 200 for Postmark "Check" button
// - POST: store raw inbound, upsert receipt, upsert return deadline
// - Never 500 due to parse issues; we log & return 200 to stop retries.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import supabaseAdmin from "../lib/supabase-admin";
import { naiveParse } from "../lib/parse";
import { computeReturnDeadline } from "../lib/policies";

// read raw body if req.body isn't already an object
async function readRaw(req: any): Promise<string> {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c: any) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Allow Postmark "Check" and health probes
  if (req.method === "GET" || req.method === "HEAD") {
    return res.status(200).json({ ok: true, info: "inbound webhook ready" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  // ---- Parse body safely
  let body: any = req.body;
  try {
    if (!body || typeof body !== "object") {
      const raw = await readRaw(req);
      body = raw ? JSON.parse(raw) : {};
    }
  } catch (e) {
    console.error("JSON parse error:", e);
    // Record inbound attempt then return 200 to avoid retries
    await supabaseAdmin.from("inbound_emails").insert([
      { user_id: null, provider: "postmark", payload: { parseError: true } },
    ]);
    return res.status(200).json({ ok: false, error: "invalid json" });
  }

  // ---- Identify user from MailboxHash (the +<USER_ID> in the inbound address)
  const mailboxHash = (body?.MailboxHash || "").trim();
  const user_id = mailboxHash || null;

  // Store the raw inbound for audit/debug no matter what
  try {
    const { error: iErr } = await supabaseAdmin.from("inbound_emails").insert([
      {
        user_id,
        provider: "postmark",
        payload: body ?? {},
      },
    ]);
    if (iErr) console.error("inbound_emails.insert error:", iErr);
  } catch (e) {
    console.error("inbound_emails.insert exception:", e);
  }

  // If we couldn't determine a user, acknowledge and exit (prevents retries)
  if (!user_id) {
    return res.status(200).json({ ok: false, info: "missing MailboxHash (user_id)" });
  }

  // ---- Build a parseable text blob
  const fromEmail: string = body?.FromFull?.Email || body?.From || "";
  const subject: string = body?.Subject || "";
  const textBody: string = body?.TextBody || "";
  const htmlBody: string = body?.HtmlBody || "";
  const parseSource = [subject, textBody, htmlBody].join("\n\n");

  // ---- Parse minimal receipt fields
  const parsed = naiveParse(parseSource, fromEmail);
  const merchant = (parsed.merchant || "").toLowerCase(); // normalized
  const order_id = parsed.order_id ?? "";                 // empty string allowed
  const purchase_date = parsed.purchase_date ?? null;     // 'YYYY-MM-DD' or null
  const total_cents = parsed.total_cents ?? null;         // number or null

  // If we cannot parse enough to build a reasonable receipt key, just ack
  if (!merchant || !purchase_date) {
    console.warn("Parse incomplete; merchant or purchase_date missing", {
      merchant,
      purchase_date,
      subject,
      fromEmail,
    });
    return res.status(200).json({
      ok: false,
      info: "parse incomplete (merchant/purchase_date missing)",
    });
  }

  // ---- Upsert receipt (unique natural key)
  // Unique constraint in DB: (user_id, merchant, order_id, purchase_date)
  let receiptId: string | null = null;
  try {
    const { data, error } = await supabaseAdmin
      .from("receipts")
      .upsert(
        [
          {
            user_id,
            merchant,
            order_id,       // '' is OK (we normalized order_id default in DB)
            purchase_date,  // e.g., '2025-01-02'
            total_cents,
          },
        ],
        { onConflict: "user_id,merchant,order_id,purchase_date" }
      )
      .select("id")
      .single();

    if (error) {
      console.error("receipts.upsert error:", error);
      // We already stored the raw inbound; ack 200 to stop retries
      return res.status(200).json({ ok: false, where: "receipts.upsert", error });
    }
    receiptId = data?.id ?? null;
  } catch (e) {
    console.error("receipts.upsert exception:", e);
    return res.status(200).json({ ok: false, where: "receipts.upsert", error: String(e) });
  }

  // ---- Compute & upsert return deadline (unique on receipt_id + type)
  try {
    const due = computeReturnDeadline(merchant, purchase_date || "");
    if (due && receiptId) {
      const { error: dErr } = await supabaseAdmin
        .from("deadlines")
        .upsert(
          [
            {
              receipt_id: receiptId,
              type: "return",
              status: "open",
              due_at: due.toISOString(),
            },
          ],
          { onConflict: "receipt_id,type" }
        );
      if (dErr) {
        console.error("deadlines.upsert error:", dErr);
        // Still 200 so Postmark won’t retry endlessly
        return res.status(200).json({ ok: false, where: "deadlines.upsert", error: dErr });
      }
    }
  } catch (e) {
    console.error("deadlines.upsert exception:", e);
    return res.status(200).json({ ok: false, where: "deadlines.upsert", error: String(e) });
  }

  return res.status(200).json({ ok: true, receipt_id: receiptId });
}
