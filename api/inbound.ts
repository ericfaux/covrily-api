// api/inbound.ts
// Postmark Inbound webhook with dynamic policy lookup + merchant detection from subject/body.

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
  [k: string]: any;
};

// --- merchant helpers ---
const MERCHANT_ALIASES: Array<{ rx: RegExp; canonical: string }> = [
  { rx: /\b(best\s*buy|bestbuy\.com)\b/i, canonical: "bestbuy.com" },
  { rx: /\b(target|target\.com)\b/i, canonical: "target.com" },
  { rx: /\b(walmart|walmart\.com)\b/i, canonical: "walmart.com" },
  { rx: /\b(home\s*depot|homedepot\.com)\b/i, canonical: "home depot" },
  { rx: /\b(costco|costco\.com)\b/i, canonical: "costco" },
];

const GENERIC_SENDERS = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "covrily.com",
];

function baseDomain(s: string | undefined | null): string {
  if (!s) return "";
  const x = s.toLowerCase().trim();
  const m = x.match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/i);
  const host = m ? m[1] : x;
  const parts = host.replace(/^www\./, "").split(".");
  if (parts.length >= 2) return parts.slice(-2).join(".");
  return host;
}

function detectMerchant(fromEmail: string, subject: string, body: string): string {
  const fromDomain = baseDomain(fromEmail);

  // If it's clearly a store domain and not a generic mailbox provider, keep it.
  if (fromDomain && !GENERIC_SENDERS.includes(fromDomain)) {
    return fromDomain;
  }

  // Otherwise try to infer from subject/body keywords
  const hay = `${subject}\n${body}`.toLowerCase();
  for (const m of MERCHANT_ALIASES) {
    if (m.rx.test(hay)) return m.canonical;
  }

  // Last try: any "something.com" in the body?
  const dm = hay.match(/\b([a-z0-9-]+\.com)\b/i);
  if (dm && dm[1] && !GENERIC_SENDERS.includes(dm[1].toLowerCase())) {
    return dm[1].toLowerCase();
  }

  return fromDomain || "unknown";
}

function toDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

async function parseJsonBody(req: any): Promise<any | null> {
  if (req.body && typeof req.body === "object") return req.body;
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
    req.on("end", () => {
      try { resolve(JSON.parse(raw)); } catch { resolve(null); }
    });
    req.on("error", () => resolve(null));
  });
}

export default async function handler(req: any, res: any) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, info: "inbound webhook ready" });
  }

  const body = (await parseJsonBody(req)) as PMInbound | null;
  if (!body?.MailboxHash) {
    return res.status(200).json({ ok: true, info: "noop (no MailboxHash)" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL!;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const userId = body.MailboxHash;

  // 1) Log raw inbound
  await supabase.from("inbound_emails").insert({
    user_id: userId,
    provider: "postmark",
    payload: body,
  });

  // 2) Parse basics
  const fromAddr = body.FromFull?.Email || body.From || "";
  const text = (body.TextBody || "") as string;
  const subj = body.Subject || "";
  const parsed = naiveParse(text || (body.HtmlBody as string) || "", fromAddr);

  // NEW: smarter merchant detection
  const merchantKey =
    detectMerchant(fromAddr, subj, `${subj}\n${text}`) ||
    baseDomain(parsed.merchant) ||
    "unknown";

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

  // 4) Try policy-based deadline (type='return'), fallback to legacy helper
  let dueAt: Date | null = null;
  let policyId: string | null = null;

  const { data: polRows } = await supabase
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

  const policy = polRows && polRows[0] ? polRows[0] : null;
  if (policy && policy.rules && typeof policy.rules.window_days === "number") {
    const d = new Date(purchaseDate);
    d.setDate(d.getDate() + Number(policy.rules.window_days));
    dueAt = d;
    policyId = policy.id;
  } else {
    dueAt = fallbackPolicy(merchantKey, purchaseDate.toISOString().slice(0, 10));
  }

  // 5) Upsert the return deadline (idempotent)
  if (dueAt) {
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
        .update({ due_at: dueAt.toISOString(), source_policy_id: policyId })
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
