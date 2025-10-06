// PATH: api/gmail/merchants.ts
// Assumes callers either pass a Supabase session JWT or an explicit user param; trade-off is handling
// both flows during transition so we can gradually remove the insecure query parameter once clients
// adopt authenticated requests.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ReauthorizeNeeded, ensureAccessToken, listLikelyMerchants } from "../../lib/gmail.js";
import { saveApprovedMerchants } from "../../lib/merchants.js";
import { supabaseAdmin } from "../../lib/supabase-admin.js";

async function resolveUserId(req: VercelRequest): Promise<string | null> {
  const queryUser = typeof req.query.user === "string" ? req.query.user.trim() : "";
  if (queryUser) {
    return queryUser;
  }

  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (typeof authHeader === "string") {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) {
      const token = match[1];
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (!error && data?.user?.id) {
        return data.user.id;
      }
    }
  }

  return null;
}

function parseJsonBody<T = any>(req: VercelRequest): T | null {
  if (!req.body) return null;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body) as T;
    } catch {
      return null;
    }
  }
  if (typeof req.body === "object") {
    return req.body as T;
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await resolveUserId(req);
    if (!user) {
      return res.status(401).json({ ok: false, error: "missing user", reauthorize: false });
    }

    if (req.method === "GET") {
      try {
        const { expiresAt } = await ensureAccessToken(user);
        return res.status(200).json({ ok: true, user, expiresAt });
      } catch (err) {
        if (err instanceof ReauthorizeNeeded) {
          return res.status(401).json({ ok: false, reauthorize: true });
        }
        console.error("[gmail] probe failed", err);
        return res.status(500).json({ ok: false, error: "internal_error", reauthorize: false });
      }
    }

    if (req.method === "POST") {
      const body = parseJsonBody(req) || {};

      if (Array.isArray((body as any).merchants)) {
        try {
          const merchantIds = ((body as any).merchants as any[])
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter((value) => value.length > 0);
          await saveApprovedMerchants(user, merchantIds);
          return res.status(200).json({ ok: true });
        } catch (err) {
          console.error("[gmail] save merchants failed", err);
          return res.status(500).json({ ok: false, error: "internal_error", reauthorize: false });
        }
      }

      const lookbackValue = Number((body as any).lookbackDays);
      const maxMessagesValue = Number((body as any).maxMessages);
      const lookbackDays = Number.isFinite(lookbackValue) ? lookbackValue : 90;
      const maxMessages = Number.isFinite(maxMessagesValue) ? maxMessagesValue : 50;

      let expiresAt: string | null = null;
      try {
        const tokenInfo = await ensureAccessToken(user);
        expiresAt = tokenInfo.expiresAt;
      } catch (err) {
        if (err instanceof ReauthorizeNeeded) {
          return res.status(401).json({ ok: false, reauthorize: true });
        }
        console.error("[gmail] ensure token failed", err);
        return res.status(500).json({ ok: false, error: "internal_error", reauthorize: false });
      }

      try {
        const merchants = await listLikelyMerchants(user, lookbackDays, maxMessages);
        return res.status(200).json({ ok: true, user, expiresAt, merchants });
      } catch (err) {
        if (err instanceof ReauthorizeNeeded) {
          return res.status(401).json({ ok: false, reauthorize: true });
        }
        console.error("[gmail] list merchants failed", err);
        return res.status(500).json({ ok: false, error: "internal_error", reauthorize: false });
      }
    }

    res.setHeader("Allow", "GET,POST");
    return res.status(405).end();
  } catch (e: any) {
    console.error("[gmail] merchants handler error", e);
    return res.status(500).json({ ok: false, error: "internal_error", reauthorize: false });
  }
}
