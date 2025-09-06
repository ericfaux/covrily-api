// /api/inbound.ts
// Robust Postmark Inbound webhook handler
import type { NextApiRequest, NextApiResponse } from "next";
import supabaseAdmin from "../lib/supabase-admin";
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
  const t = s.trim().replace(/^['"<\s]+|['">\s]+$/g, "");
  return t;
}
function isUuid(s?: string): boolean {
  return !!s?.match(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
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
  console.log("[inbound] received keys:", Object.keys(payload || {}));

  // 1) user id from MailboxHash or plus-address in To
  const mailboxHashRaw: string | undefined = payload?.MailboxHash;
  const toRaw: string | undefined = payload?.To || headerValue(payload, "To");
  let userId = sanitizeUuid(mailboxHashRaw);

  if (!userId) {
    const toEmail = firstAddress(toRaw);
    const plusMatch = toEmail?.match(/\+([^@]+)@/);
    userId = sanitizeUuid(plusMatch?.[1]);
  }
  if (!isUuid(userId)) {
    console.warn("[inbound] ignored — missing/invalid MailboxHash.", {
      mailboxHashRaw,
      toRaw,
      parsed: userId,
    });
    // 200 to avoid retries; nothing we can do without a user id
    return res.status(200).json({ ok: true, ignored: true, reason: "missing MailboxHash uuid" });
  }

  // 2) text parts
  const subject: string =
    payload?.Subject || headerValue(payload, "Subject") || "";
  const textBody: string =
    payload?.TextBody ||
    payload?.HtmlBody ||
    headerValue(payload, "text") ||
    "";

  const combinedText = `${subject}\n\n${textBody}`; // gives parser more to work with

  // 3) sender email (merchant hint)
  const fromEmail: string | undefined =
    payload?.FromFull?.Email ||
    payload?.From ||
    headerValue(payload, "From") ||
    firstAddress(headerValue(payload, "Reply-To"));

  // 4) naive parse
  const parsed = naiveParse(combinedText || "", fromEmail || "");
  const merchant =
    (parsed.merchant || (fromEmail?.split("@")[1] ?? "unknown")).toLowerCase();
  const orderId = parsed.order_id ?? "";
  const purchaseDate = parsed.purchase_date ?? null;
  const totalCents =
    parsed.total_cents != null ? parsed.total_cents : toCents(null);

  console.log("[inbound] parsed", { merchant, orderId, purchaseDate, totalCents });

  // 5) upsert receipt (idempotent); fallback path for unique violations
  let receiptId: string | undefined;
  try {
    const { data, error } = await supabaseAdmin
      .from("receipts")
      .upsert(
        [
          {
            user_id: userId,
            merchant,
            order_id: orderId || "",
            purchase_date: purchaseDate, // date or null
            total_cents: totalCents,
          },
        ],
        { onConflict: "user_id,merchant,order_id,purchase_date" }
      )
      .select();

    if (error) throw error;
    receiptId = data?.[0]?.id;
    console.log("[inbound] upserted receipt", receiptId);
  } catch (e: any) {
    const msg = String(e?.message || e);
    console.warn("[inbound] upsert error, attempting select+update", msg);

    // Try select existing then update (covers rare mismatch cases)
    const { data: existing, error: selErr } = await supabaseAdmin
      .from("receipts")
      .select("id")
      .eq("user_id", userId)
      .eq("merchant", merchant)
      .eq("order_id", orderId || "")
      .is("purchase_date", purchaseDate === null ? null : undefined)
      .eq(purchaseDate !== null ? "purchase_date" : "user_id", purchaseDate ?? userId) // trick to keep types valid
      .limit(1);

    if (selErr) {
      console.error("[inbound] select fallback failed:", selErr);
      return res.status(500).json({ ok: false, error: msg });
    }

    if (existing && existing.length > 0) {
      receiptId = existing[0].id;
      const { error: updErr } = await supabaseAdmin
        .from("receipts")
        .update({ total_cents: totalCents })
        .eq("id", receiptId);
      if (updErr) {
        console.error("[inbound] update fallback failed:", updErr);
        return res.status(500).json({ ok: false, error: String(updErr.message || updErr) });
      }
      console.log("[inbound] updated existing receipt", receiptId);
    } else {
      console.error("[inbound] could not locate row to update after conflict.");
      return res.status(500).json({ ok: false, error: msg });
    }
  }

  // 6) upsert deadline if a policy applies
  try {
    const deadlineDate =
      purchaseDate ? computeReturnDeadline(merchant, purchaseDate) : null;
    if (deadlineDate && receiptId) {
      const { error: dlErr } = await supabaseAdmin
        .from("deadlines")
        .upsert(
          [
            {
              receipt_id: receiptId,
              user_id: userId,
              type: "return",
              status: "open",
              due_at: deadlineDate.toISOString(),
            },
          ],
          { onConflict: "receipt_id,type" }
        );
      if (dlErr) throw dlErr;
      console.log("[inbound] upserted deadline for receipt", receiptId);
    } else {
      console.log("[inbound] no deadline (no policy or no purchase_date).");
    }
  } catch (e: any) {
    console.error("[inbound] deadline upsert failed:", e?.message || e);
    // don't fail the webhook—receipt was created
  }

  return res.status(200).json({ ok: true });
}
