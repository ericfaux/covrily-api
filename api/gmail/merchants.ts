// api/gmail/merchants.ts
// Assumes Gmail discovery returns domains or sender ids that can safely backfill display names;
// trade-off is deriving a best-effort pretty label locally to keep the UI readable without storing
// additional metadata in Supabase.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  getAccessToken,
  scanGmailMerchants,
  type MerchantDiscoveryItem,
  type MerchantDiscoverySource,
} from "../../lib/gmail-scan.js";
import { saveApprovedMerchants } from "../../lib/merchants.js";
import { supabaseAdmin } from "../../lib/supabase-admin.js";

interface NormalizedMerchant {
  id: string;
  name: string;
  est_count?: number;
  source?: MerchantDiscoverySource;
}

type MerchantInput =
  | MerchantDiscoveryItem
  | string
  | {
      id?: string | null;
      domain?: string | null;
      name?: string | null;
      est_count?: number | null;
      source?: string | null;
    };

function prettyNameFromId(id: string): string {
  const trimmed = id.trim().toLowerCase();
  if (!trimmed) return id;
  const withoutTld = trimmed.replace(/\.(com|net|org|co|io|store|shop)$/i, "");
  const segments = withoutTld.split(".");
  const primary = segments[0] || trimmed;
  return primary
    .split(/[-_]/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
    .filter(Boolean)
    .join(" ") || id;
}

function normalizeMerchants(items: MerchantInput[]): NormalizedMerchant[] {
  const deduped = new Map<string, NormalizedMerchant>();
  for (const entry of items) {
    if (!entry) continue;
    let id: string | null = null;
    let name: string | null = null;
    let estCount: number | null = null;
    let source: MerchantDiscoverySource | undefined;

    if (typeof entry === "string") {
      id = entry;
    } else {
      const candidate: any = entry;
      if (typeof candidate.id === "string") {
        id = candidate.id;
      } else if (typeof candidate.domain === "string") {
        id = candidate.domain;
      }
      if (typeof candidate.name === "string") name = candidate.name;
      if (typeof candidate.est_count === "number" && Number.isFinite(candidate.est_count)) {
        estCount = candidate.est_count;
      }
      if (candidate.source === "smartlabel" || candidate.source === "heuristic") {
        source = candidate.source;
      }
    }

    if (!id) continue;
    const normalizedId = id.trim().toLowerCase();
    if (!normalizedId) continue;

    const displayName = (name || "").trim() || prettyNameFromId(normalizedId);
    const existing = deduped.get(normalizedId);
    if (existing) {
      // Merge duplicates so domains stay unique while preserving count and best source.
      if (typeof estCount === "number") {
        const current = existing.est_count ?? 0;
        existing.est_count = current + estCount;
      }
      if (!existing.name && displayName) {
        existing.name = displayName;
      }
      if (source === "smartlabel" && existing.source !== "smartlabel") {
        existing.source = "smartlabel";
      } else if (!existing.source && source) {
        existing.source = source;
      }
      continue;
    }

    const record: NormalizedMerchant = {
      id: normalizedId,
      name: displayName,
    };
    if (typeof estCount === "number") record.est_count = estCount;
    if (source) record.source = source;
    deduped.set(normalizedId, record);
  }

  return Array.from(deduped.values());
}

function normalizeMerchantIds(values: any[]): string[] {
  const ids = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    let id: string | null = null;
    if (typeof value === "string") {
      id = value;
    } else if (typeof value === "object") {
      const candidate: any = value;
      if (typeof candidate.id === "string") {
        id = candidate.id;
      } else if (typeof candidate.domain === "string") {
        id = candidate.domain;
      }
    }
    if (!id) continue;
    const normalized = id.trim().toLowerCase();
    if (normalized) ids.add(normalized);
  }
  return Array.from(ids);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") {
      const user = (req.query.user as string) || "";
      if (!user) return res.status(400).json({ ok: false, error: "missing user" });

      const tokens = await getAccessToken(user);
      const status = tokens?.status ? String(tokens.status).toLowerCase() : null;
      if (!tokens || !tokens.accessToken || status === "reauth_required") {
        return res.status(428).json({
          ok: false,
          code: "reauth_required",
        });
      }

      const { merchants } = await scanGmailMerchants(user, tokens);
      const normalized = normalizeMerchants(merchants);

      const deleteResult = await supabaseAdmin
        .from("auth_merchants")
        .delete()
        .eq("user_id", user);
      if (deleteResult.error) {
        console.error("[auth_merchants delete]", { user, error: deleteResult.error });
        throw deleteResult.error;
      }
      if (normalized.length > 0) {
        const payload = normalized.map((item) => ({
          // Only persist identifiers because auth_merchants schema currently exposes
          // { user_id, merchant }. Additional metadata stays in memory for UI rendering.
          user_id: user,
          merchant: item.id,
        }));
        const { error } = await supabaseAdmin
          .from("auth_merchants")
          .upsert(payload, { onConflict: "user_id,merchant" });
        if (error) {
          console.error("[auth_merchants upsert]", { user, error });
          throw error;
        }
      }

      return res.status(200).json({ ok: true, merchants: normalized });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { user, merchants } = body || {};
      if (!user || !Array.isArray(merchants)) {
        return res.status(400).json({ ok: false, error: "missing user or merchants" });
      }

      const merchantIds = normalizeMerchantIds(merchants);
      await saveApprovedMerchants(user, merchantIds);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET,POST");
    res.status(405).end();
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
}
