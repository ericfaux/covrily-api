// /api/inbound.ts
// Postmark Inbound webhook -> upsert receipt -> create/update deadline

import type { NextApiRequest, NextApiResponse } from "next";
import supabaseAdmin from "../lib/supabase-admin";
import { naiveParse } from "../lib/parse";
import { computeReturnDeadline } from "../lib/policies";

// --- helpers ---------------------------------------------------------------

async function readJson(req: NextApiRequest): Promise<any> {
  // If Next already parsed JSON, use it
  if (req.body && typeof req.body === "object") return req.body;

  // Otherwise read raw and parse
  const raw = await new Promise<string>((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => resolve(buf));
    req.on("error", reject);
  });

  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

// Postmark puts headers in `Headers: Array<{ Name, Value }>`
function headerValue(payload: any, name: string): string | undefined {
  const arr: Array<{ Name?: string; Value?: string }> | undefined =
    payload?.Headers;
  return arr?.find((h) => h?.Name?.toLowerCase() === name.toLowerCase())
    ?.Value;
}

function firstAddress(value?: string): string | undefined {
  // "A <a@b.com>, C <c@d.com>" -> "a@b.com"
  if (!value) return undefined;
  const m =
    value.match(/<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i) || undefined;
  return m?.[1];
}

function toCents(n?: number | string | null): number | null {
  if (n == null || n === "") return null;
  const v = typeof n === "number" ? n : parseFloat(String(n).replace(/[^\d.]/g, ""));
  if (Number.isNaN(v)) return null;
  return Math.round(v * 100);
}

function isUuid(s?: string): boolean {
  return !!s?.match(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
}

// --- handler ---------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 1) health check / GET
  if (req.method === "GET" || req.method === "HEAD") {
    return res.status(200).json({ ok: true, info: "inbound webhook ready" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // 2) parse body safely
  const payload = await readJson(req);

  // Minimal debug to Vercel logs (safe keys only)
  console.log("[inbound] keys:", Object.keys(payload || {}));

  // 3) derive userId from MailboxHash (the part after + in address)
  const mailboxHash: string | undefined = payload?.MailboxHash;
  const toRaw: string | undefined =
    payload?.To || headerValue(payload, "To"); // for fallback

  // If MailboxHash missing, try to extract +hash from the first "To"
  let userId = mailboxHash;
  if (!userId) {
    const toEmail = firstAddress(toRaw);
    const plusMatch = toEmail?.match(/\+([^@]+)@/);
    userId = plusMatch?.[1];
  }

  if (!isUuid(userId)) {
    console.error("[inbound] missing/invalid userId (MailboxHash).", {
      mailboxHash,
      toRaw,
      userId,
    });
    // 200 here so Postmark doesn't keep retrying forever; but we log it.
    return res
      .status(200)
      .json({ ok: true, ignored: true, reason: "missing MailboxHash uuid" });
  }

  // 4) collect text & from
  const textBody: string | undefined =
    payload?.TextBody ??
    payload?.HtmlBody ??
    headerValue(payload, "text") ??
    headerValue(payload, "body");

  const fromEmail: string | undefined =
    payload?.FromFull?.Email ??
    payload?.From ??
    headerValue(payload, "From") ??
    firstAddress(headerValue(payload, "Reply-To"));

  // 5) naive parse -> { merchant, order_id?, purchase_date?, total_cents? }
  const parsed = naiveParse(textBody || "", fromEmail || "");
  const merchant =
    parsed.merchant ||
    (fromEmail ? String(fromEmail.split("@")[1] || "").toLowerCase() : "unknown");

  const orderId = parsed.order_id ?? "";
  const purchaseDate = parsed.purchase_date ?? null;
  const totalCents =
    parsed.total_cents != null ? parsed.total_cents : toCents(null);

  // 6) upsert receipt
  try {
    const { data: upserted, error: upErr } = await supabaseAdmin
      .from("receipts")
      .upsert(
        [
          {
            user_id: userId,
            merchant,
            order_id: orderId || "",
            purchase_date: purchaseDate, // can be null
            total_cents: totalCents,
          },
        ],
        {
          onConflict: "user_id,merchant,order_id,purchase_date",
          ignoreDuplicates: false,
        }
      )
      .select();

    if (upErr) throw upErr;

    const receipt = upserted?.[0];
    console.log("[inbound] upserted receipt:", receipt?.id, {
      merchant,
      orderId,
      purchaseDate,
      totalCents,
    });

    // 7) compute + upsert deadline (if policy yields a date)
    const deadlineDate = purchaseDate
      ? computeReturnDeadline(merchant, purchaseDate)
      : null;

    if (deadlineDate) {
      const { error: dlErr } = await supabaseAdmin
        .from("deadlines")
        .upsert(
          [
            {
              receipt_id: receipt.id,
              user_id: userId,
              type: "return",
              status: "open",
              due_at: deadlineDate.toISOString(),
            },
          ],
          { onConflict: "receipt_id,type", ignoreDuplicates: false }
        );
      if (dlErr) throw dlErr;
      console.log("[inbound] upserted deadline for receipt:", receipt.id);
    } else {
      console.log("[inbound] no deadline (policy returned null).");
    }
  } catch (e: any) {
    console.error("[inbound] receipts.upsert exception:", e?.message || e);
    // return 500 so Postmark will retry automatically
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }

  return res.status(200).json({ ok: true });
}
