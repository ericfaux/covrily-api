// api/inbound.ts
// Postmark Inbound webhook handler with dynamic policy lookup.
// - Always 200 for checks/GET/POST without MailboxHash
// - On real events: store raw inbound, create receipt, compute deadline from policies.

import { createClient } from "@supabase/supabase-js";
import { naiveParse } from "../lib/parse";
import { computeReturnDeadline as fallbackPolicy } from "../lib/policies";

type PMInbound = {
  MailboxHash?: string; // <USER_ID>
  FromFull?: { Email?: string; Name?: string };
  From?: string;
  Subject?: string;
  HtmlBody?: string;
  TextBody?: string;
  To?: string;
  Cc?: string;
  Bcc?: string;
  // ...Postmark provides many more fields; we treat the payload as opaque JSON
  [k: string]: any;
};

// ---- small helpers ----
function baseDomain(s: string | undefined | null): string {
  if (!s) return "";
  const x = s.toLowerCase().trim();
  // from email like "no-reply@bestbuy.com"
  const m = x.match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/i);
  const host = m ? m[1] : x;
  const parts = host.replace(/^www\./, "").split(".");
  if (parts.length >= 2) return parts.slice(-2).join(".");
  return host;
}

function toDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

async function parseJsonBody(req: any): Promise<any | null> {
  // Vercel/Next may already parse JSON; otherwise read the stream.
  if (req.body && typeof req.body === "object") return req.body;
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

export default async function handler(req: any, res: any) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, info: "inbound webhook ready" });
  }

  // Always 200 to keep Postmark happy, even if body is missing (Check button etc.)
  const body = (await parseJsonBody(req)) as PMInbound | null;
  if (!body?.MailboxHash) {
    return res.status(200).json({ ok: true, info: "noop (no MailboxHash)" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL!;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const userId = body.MailboxHash; // We set this in the recipient email as +<USER_ID>

  // 1) Log raw inbound (audit/debug)
  const { data: inboundRow, error: inboundErr } = await supabase
    .from("inbound_emails")
    .insert({
      user_id: userId,
      provider: "postmark",
      payload: body,
    })
    .select("id")
    .single();

  if (inboundErr) {
    console.error("INBOUND_INSERT_ERROR", inboundErr);
  }

  // 2) Parse receipt basics
  const fromAddr =
    body.FromFull?.Email || body.From || ""; // e.g., noreply@bestbuy.com
  const parsed = naiveParse((body.TextBody || body.HtmlBody || "") as string, fromAddr);

  const merchantKey =
    baseDomain(parsed.merchant) || baseDomain(fromAddr) || "unknown";

  const purchaseDate =
    toDate((parsed as any).purchase_date) ||
    toDate((parsed as any).purchase_date2) ||
    new Date();

  const totalCents =
    typeof (parsed as any).total_cents === "number"
      ? (parsed as any).total_cents
      : null;

  // 3) Create receipt
  const { data: receipt, error: recErr } = await supabase
    .from("receipts")
    .insert({
      user_id: userId,
      merchant: merchantKey,
      order_id: (parsed as any).order_id ?? null,
      total_cents: totalCents,
      purchase_date: purchaseDate.toISOString().slice(0, 10),
      channel: "email",
    })
    .select("id, user_id, merchant, purchase_date")
    .single();

  if (recErr || !receipt) {
    console.error("RECEIPT_INSERT_ERROR", recErr);
    return res.status(200).json({ ok: true, info: "receipt insert failed" });
  }

  // 4) Try policy-based deadline from DB (type='return'), fallback to legacy helper
  let dueAt: Date | null = null;
  let policyId: string | null = null;

  // Find a policy row that matches domain or printable name
  const { data: polRows, error: polErr } = await supabase
    .from("policies")
    .select("id, merchant, type, rules")
    .eq("type", "return")
    .or(
      [
        `merchant.ilike.%${merchantKey}%`,
        `merchant.ilike.%${merchantKey.replace(".com", "")}%`,
      ].join(",")
    )
    .limit(1);

  if (polErr) {
    console.error("POLICY_LOOKUP_ERROR", polErr);
  }

  const policy = polRows && polRows[0] ? polRows[0] : null;
  if (policy && policy.rules && typeof policy.rules.window_days === "number") {
    const d = new Date(purchaseDate);
    d.setDate(d.getDate() + Number(policy.rules.window_days));
    dueAt = d;
    policyId = policy.id;
  } else {
    // Fallback logic from our simple helper (e.g., Best Buy 15 days)
    dueAt = fallbackPolicy(merchantKey, purchaseDate.toISOString().slice(0, 10));
  }

  // 5) Insert (or update) return deadline if we have one
  if (dueAt) {
    // idempotency: if an OPEN return deadline exists for this receipt, update it; else insert
    const { data: existing } = await supabase
      .from("deadlines")
      .select("id")
      .eq("receipt_id", receipt.id)
      .eq("type", "return")
      .eq("status", "open")
      .maybeSingle();

    if (existing?.id) {
      await supabase
        .from("deadlines")
        .update({
          due_at: dueAt.toISOString(),
          source_policy_id: policyId,
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("deadlines").insert({
        user_id: receipt.user_id,
        receipt_id: receipt.id,
        type: "return",
        due_at: dueAt.toISOString(),
        status: "open",
        source_policy_id: policyId,
      });
    }
  }

  return res.status(200).json({
    ok: true,
    merchant: merchantKey,
    receipt_id: receipt.id,
    policy_id: policyId,
    deadline: dueAt ? dueAt.toISOString() : null,
  });
}
