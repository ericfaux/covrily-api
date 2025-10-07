// PATH: api/connectors/gmail/reauthorize.ts
// Assumes reauth requests originate from trusted callers providing a valid user id; trade-off is
// issuing state-encoded OAuth URLs without extra CSRF tokens, relying on Supabase-authenticated
// flows to guard the endpoint.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getGoogleAuthUrl } from "../../../lib/gmail.js";
import { supabaseAdmin } from "../../../lib/supabase-admin.js";

function parseUser(req: VercelRequest): string {
  if (typeof req.body === "string") {
    try {
      const parsed = JSON.parse(req.body);
      if (parsed && typeof parsed === "object" && typeof parsed.user === "string") {
        const trimmed = parsed.user.trim();
        if (trimmed) return trimmed;
      }
    } catch {
      // ignore parse errors and fall through
    }
  }
  if (req.body && typeof req.body === "object") {
    const candidate = (req.body as any).user;
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  const fromQuery = req.query.user;
  if (typeof fromQuery === "string" && fromQuery.trim()) return fromQuery.trim();
  return "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  try {
    const user = parseUser(req);
    if (!user) {
      return res.status(400).json({ ok: false, error: "missing user" });
    }

    const { data: existingRow, error: fetchError } = await supabaseAdmin
      .from("gmail_tokens")
      .select("user_id")
      .eq("user_id", user)
      .maybeSingle();
    if (fetchError) {
      throw fetchError;
    }

    if (existingRow) {
      const { error: updateError } = await supabaseAdmin
        .from("gmail_tokens")
        .update({
          status: "reauth_required",
          reauth_required: true,
          access_token: null,
          access_token_expires_at: null,
        })
        .eq("user_id", user);
      if (updateError) {
        throw updateError;
      }
    } else {
      const { error: insertError } = await supabaseAdmin
        .from("gmail_tokens")
        .upsert(
          {
            user_id: user,
            refresh_token: null,
            access_token: null,
            access_token_expires_at: null,
            granted_scopes: [],
            status: "reauth_required",
            reauth_required: true,
          },
          { onConflict: "user_id" }
        );
      if (insertError) {
        throw insertError;
      }
    }

    const statePayload = Buffer.from(JSON.stringify({ user }), "utf8").toString("base64url");
    const url = getGoogleAuthUrl(statePayload);

    return res.status(200).json({ ok: true, url });
  } catch (err) {
    console.error("[gmail] reauthorize failed", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
}
