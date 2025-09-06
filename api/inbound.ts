// api/inbound.ts
// Postmark Inbound webhook handler.
// ✅ Always 200 for checks (GET/HEAD or POST without MailboxHash)
// ✅ Only writes to Supabase when a real Inbound event contains MailboxHash (<USER_ID>)

import { createClient } from "@supabase/supabase-js";
import { naiveParse } from "../lib/parse";
import { computeReturnDeadline } from "../lib/policies";

// Safely read & parse JSON if req.body isn't already available
async function parseJsonBody(req: any): Promise<any | null> {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  // Read raw stream
  const raw: string = await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c: any) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export default async function handler(req: any, res: any) {
  try {
    // 1) Postmark "Check" often uses GET/HEAD -> return 200 OK
    if (req.method !== "POST") {
      return res.status(200).json({ ok: true, info: "inbound webhook ready" });
    }

    // 2) Try to parse JSON. If missing/invalid, treat as a check.
    const payload = await parseJsonBody(req);
    const userId = payload?.MailboxHash ? String(payload.MailboxHash) : null;
    if (!userId) {
      return res.status(200).json({ ok: true, info: "check (no MailboxHash)" });
    }

    // 3) Build Supabase admin client lazily (only for real events)
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      console.error("MISSING_SUPABASE_ENV");
      return res.status(500).json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    }
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const from = payload?.From || "";
    const text = payload?.TextBody || "";
    const html = payload?.HtmlBody || "";

    // 4) Store raw inbound event
    const insInbound = await supabase.from("inbound_emails").insert({
      user_id: userId,
      provider: "postmark",
      payload
    });
    if (insInbound.error) {
      console.error("DB inbound_emails insert error:", insInbound.error);
      return res.status(500).json({ error: "DB inbound_emails", details: insInbound.error.message });
    }

    // 5) Parse -> create receipt
    const parsed = naiveParse(text || html, from);
    const insReceipt = await supabase
      .from("receipts")
      .insert({
        user_id: userId,
        merchant: parsed.merchant,
        order_id: parsed.order_id,
        total_cents: parsed.total_cents,
        purchase_date: parsed.purchase_date,
        channel: "email",
        raw_json: payload
      })
      .select()
      .single();
    if (insReceipt.error) {
      console.error("DB receipts insert error:", insReceipt.error);
      return res.status(500).json({ error: "DB receipts", details: insReceipt.error.message });
    }

    // 6) Optional: add a simple return deadline for Best Buy-like senders
    const receipt = insReceipt.data;
    const dueAt =
      parsed.purchase_date && computeReturnDeadline(parsed.merchant, parsed.purchase_date);
    if (dueAt) {
      const insDeadline = await supabase.from("deadlines").insert({
        user_id: userId,
        receipt_id: receipt.id,
        type: "return",
        due_at: dueAt.toISOString(),
        status: "open"
      });
      if (insDeadline.error) console.error("DB deadlines insert error:", insDeadline.error);
    }

    return res.status(200).json({
      ok: true,
      receipt_id: receipt.id,
      deadline_created: Boolean(dueAt)
    });
  } catch (e: any) {
    console.error("INBOUND_ERROR:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
