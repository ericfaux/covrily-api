// /api/inbound.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { supabaseAdmin } from "../lib/supabase-admin";
import { naiveParse } from "../lib/parse";
import { computeReturnDeadline } from "../lib/policies";

// ---------- helpers ----------
async function readJson(req: NextApiRequest): Promise<any> {
  if (req.body && typeof req.body === "object") return req.body;
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

// Postmark stores headers in `Headers: Array<{ Name, Value }>`
function headerValue(payload: any, name: string): string | undefined {
  const arr: Array<{ Name?: string; Value?: string }> | undefined = payload?.Headers;
  return arr?.find((h) => h?.Name?.toLowerCase() === name.toLowerCase())?.Value;
}

function firstAddress(v?: string): string | undefined {
  if (!v) return undefined;
  const m = v.match(/<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i);
  return m?.[1];
}

function sanitizeUuid(s?: string): string | undefined {
  if (!s) return undefined;
  return s.trim().replace(/^['"<\s]+|['">\s]+$/g, "");
}
function isUuid(s?: string): boolean {
  return !!s?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
}

function toCents(n?: number | string | null): number | null {
  if (n == null || n === "") return null;
  const v = typeof n === "number" ? n : parseFloat(String(n).replace(/[^\d.]/g, ""));
  if (Number.isNaN(v)) return null;
  return Math.round(v * 100);
}

// ---------- handler ----------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET" || req.method === "HEAD") {
    return res.status(200).json({ ok: true, info: "inbound webhook ready" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const payload = await readJson(req);
  console.log("[inbound] keys:", Object.keys(payload || {}));

  // 1) userId from MailboxHash or plus-address in To
  const mailboxHashRaw: string | undefined = payload?.MailboxHash;
  const toRaw: string | undefined = payload?.To || headerValue(payload, "To");
  let userId = sanitizeUuid(mailboxHashRaw);
  if (!userId) {
    const toEmail = firstAddress(toRaw);
    const plusMatch = toEmail?.match(/\+([^@]+)@/);
    userId = sanitizeUuid(plusMatch?.[1]);
  }
  if (!isUuid(userId)) {
    console.warn("[inbound] ignored — missing/invalid MailboxHash.", { mailboxHashRaw, toRaw, userId });
    return res.status(200).json({ ok: true, ignored: true, reason: "missing MailboxHash uuid" });
  }

  // 2) text to parse
  const subject: string = payload?.Subject || headerValue(payload, "Subject") || "";
  const textBody: string = payload?.TextBody || "";
  const combinedText = `${subject}\n\n${textBody}`;

  const fromEmail: string | undefined =
    payload?.FromFull?.Email ||
    payload?.From ||
    headerValue(payload, "From") ||
    firstAddress(headerValue(payload, "Reply-To"));

  // 3) naive parse
  const parsed = naiveParse(combinedText, fromEmail || "");
  const merchant = (parsed.merchant || (fromEmail?.split("@")[1] ?? "unknown")).toLowerCase();
  const orderId = parsed.order_id ?? "";
  const purchaseDate = parsed.purchase_date ?? null; // 'YYYY-MM-DD' or null
  const totalCents = parsed.total_cents != null ? parsed.total_cents : toCents(null);

  console.log("[inbound] parsed:", { merchant, orderId, purchaseDate, totalCents });

  // 4) upsert receipt
  try {
    const { data, error } = await supabaseAdmin
      .from("receipts")
      .upsert(
        [
          {
            user_id: userId,
            merchant,
            order_id: orderId || "",
            purchase_date: purchaseDate,
            total_cents: totalCents,
          },
        ],
        { onConflict: "user_id,merchant,order_id,purchase_date" }
      )
      .select("id")
      .single();

    if (error) throw error;
    const receiptId: string | undefined = data?.id;
    console.log("[inbound] receipt upserted:", receiptId);

    // 5) upsert deadline if policy applies (NO user_id column in deadlines)
    const due = purchaseDate ? computeReturnDeadline(merchant, purchaseDate) : null;
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
      if (dErr) console.error("[inbound] deadline upsert error:", dErr);
      else console.log("[inbound] deadline upserted for receipt:", receiptId);
    } else {
      console.log("[inbound] no deadline (no policy or no purchase_date).");
    }
  } catch (e: any) {
    console.error("[inbound] receipts.upsert exception:", e?.message || e);
    // Return 500 so Postmark retries once more after deploys; if you prefer to ack and not retry, return 200.
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }

  return res.status(200).json({ ok: true });
}
