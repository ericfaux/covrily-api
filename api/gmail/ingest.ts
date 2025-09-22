// api/gmail/ingest.ts
// Assumes Gmail tokens carry status plus a legacy boolean so we can block ingestion cleanly;
// trade-off is performing extra Supabase writes when scopes fail so both flags stay synced.
// Fetch Gmail messages for approved merchants and store receipts

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";
import { createHash } from "crypto";
import parsePdf from "../../lib/pdf.js";
import { naiveParse, type ParsedReceipt } from "../../lib/parse.js";
import { supabaseAdmin } from "../../lib/supabase-admin.js";
import { getAccessToken } from "../../lib/gmail-scan.js";
import { withRetry } from "../../lib/retry.js";
import extractReceipt from "../../lib/llm/extract-receipt.js";
import { logParseResult } from "../../lib/parse-log.js";
import extractReceiptLink, {
  type ReceiptLinkCandidate,
} from "../../lib/llm/extract-receipt-link.js";
import { load } from "cheerio";

export const config = { runtime: "nodejs" };

const PROCESSED_LABEL_NAME = "CovrilyProcessed";
const FULL_MAILBOX_SCOPES = [
  "https://mail.google.com/",
  "https://mail.google.com",
] as const;
const MODIFY_SCOPES = new Set<string>([
  ...FULL_MAILBOX_SCOPES,
  "https://www.googleapis.com/auth/gmail.modify",
]);
const LABEL_CREATION_SCOPES = new Set<string>([
  ...FULL_MAILBOX_SCOPES,
  "https://www.googleapis.com/auth/gmail.labels",
]);

const REQUIRED_WRITE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/gmail.modify",
];

const LABELING_ENABLED =
  (process.env.GMAIL_LABELING_ENABLED || "").toLowerCase() === "true";

const BASE_SUBJECT_QUERY =
  'subject:(receipt OR "receipt for" OR order OR "your order" OR invoice OR purchase OR bill OR transaction OR payment OR confirmation OR statement)';
const SMARTLABEL_CLAUSE = "(label:^smartlabel_receipt OR category:updates)";
const UPDATES_CLAUSE = "category:updates";
const DEFAULT_INGEST_MONTHS = 6;
const PRIMARY_RESULT_THRESHOLD = 3;
const MAX_MESSAGES_PER_QUERY = 500;

const MERCHANT_DOMAIN_CATALOG: Record<string, string[]> = {
  amazon: ["amazon.com", "amazon.ca", "amazon.co.uk"],
  "amazon.com": ["amazon.com", "amazon.ca", "amazon.co.uk"],
  "amazon.ca": ["amazon.ca"],
  "amazon.co.uk": ["amazon.co.uk"],
  "best buy": ["bestbuy.com", "bestbuy.ca"],
  bestbuy: ["bestbuy.com", "bestbuy.ca"],
  "bestbuy.com": ["bestbuy.com", "bestbuy.ca"],
  "bestbuy.ca": ["bestbuy.ca"],
  walmart: ["walmart.com", "walmart.ca"],
  "walmart.com": ["walmart.com", "walmart.ca"],
  "walmart.ca": ["walmart.ca"],
  target: ["target.com"],
  "target.com": ["target.com"],
  "home depot": ["homedepot.com"],
  homedepot: ["homedepot.com"],
  "homedepot.com": ["homedepot.com"],
  lowes: ["lowes.com"],
  "lowes.com": ["lowes.com"],
  costco: ["costco.com"],
  "costco.com": ["costco.com"],
  apple: ["apple.com"],
  "apple.com": ["apple.com"],
  paypal: ["paypal.com"],
  "paypal.com": ["paypal.com"],
  shopify: ["shopify.com"],
  "shopify.com": ["shopify.com"],
  square: ["squareup.com"],
  "squareup.com": ["squareup.com"],
  etsy: ["etsy.com"],
  "etsy.com": ["etsy.com"],
  "best buy canada": ["bestbuy.ca"],
};

function computeSinceDate(raw?: string | number | null): string {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  const months = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INGEST_MONTHS;
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const yyyy = since.getFullYear();
  const mm = String(since.getMonth() + 1).padStart(2, "0");
  const dd = String(since.getDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}`;
}

function sanitizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.@ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getMerchantDomains(raw: string): string[] {
  const domains = new Set<string>();
  const normalized = sanitizeKey(raw);
  if (!normalized) return [];

  const maybeAdd = (domain?: string | null) => {
    if (!domain) return;
    const cleaned = domain.replace(/^@/, "").trim().toLowerCase();
    if (cleaned) domains.add(cleaned);
  };

  if (normalized.includes("@")) {
    const domain = normalized.split("@").pop();
    maybeAdd(domain);
  }

  if (normalized.includes(".")) {
    maybeAdd(normalized);
  }

  const aliasKey = normalized.replace(/\./g, " ");
  for (const key of [normalized, aliasKey, aliasKey.replace(/\s+/g, " ")]) {
    const mapped = MERCHANT_DOMAIN_CATALOG[key];
    if (mapped) {
      for (const domain of mapped) maybeAdd(domain);
    }
  }

  if (domains.size === 0) {
    const fallback = normalized.replace(/\s+/g, "");
    if (fallback) {
      maybeAdd(`${fallback}.com`);
    }
  }

  return Array.from(domains);
}

function buildFromTokens(merchant: string, domains: string[]): string[] {
  const tokens = new Set<string>();
  for (const domain of domains) {
    if (!domain) continue;
    tokens.add(`@${domain}`);
  }
  const cleaned = merchant.replace(/["']/g, "").trim();
  if (cleaned) {
    tokens.add(`"${cleaned}"`);
  }
  return Array.from(tokens);
}

async function searchMessageIds(
  gmail: any,
  query: string,
  limit = MAX_MESSAGES_PER_QUERY
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const remaining = limit - ids.length;
    if (remaining <= 0) break;
    const resp: any = await withRetry(
      () =>
        gmail.users.messages.list(
          {
            userId: "me",
            q: query,
            maxResults: Math.min(remaining, 500),
            pageToken,
            format: "metadata",
            metadataHeaders: ["From", "Subject"],
          } as any
        ),
      "users.messages.list"
    );
    const messages = (resp?.data?.messages as any[]) || [];
    for (const msg of messages) {
      if (msg.id) ids.push(msg.id);
    }
    pageToken = resp?.data?.nextPageToken || undefined;
  } while (pageToken && ids.length < limit);
  return ids;
}

type ParseSourceType = "rules" | "llm";

interface NormalizedLineItem {
  sku?: string | null;
  name: string;
  qty: number;
  unit_price: number | null;
  unit_cents: number | null;
}

interface BuildReceiptParams {
  userId: string;
  merchantValue: string | null;
  fallbackMerchant: string;
  orderId: string | null;
  purchaseDate: string | null;
  totalCents: any;
  taxCents: any;
  shippingCents: any;
  currency: string | null;
  items: any[];
  emailMessageId: string;
  parseSource: ParseSourceType;
  receiptLink: string | null;
  gmail: any;
}

interface NormalizedReceiptInsert {
  merchant: string;
  order_id: string;
  purchase_date: string;
  currency: string;
  total_amount: number;
  total_cents: number;
  taxes: number | null;
  tax_cents: number | null;
  shipping: number | null;
  shipping_cents: number | null;
  line_items: NormalizedLineItem[];
  email_message_id: string;
  parse_source: ParseSourceType;
  confidence: number;
  receipt_url: string | null;
  dedupe_key: string;
  raw_json: any;
}

function capitalizeWords(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : ""))
    .filter(Boolean)
    .join(" ");
}

function formatMerchantName(raw: string | null, fallback: string): string | null {
  const base = (raw || fallback || "").trim();
  if (!base) return null;
  let candidate = base.replace(/["']/g, "");
  const atIndex = candidate.lastIndexOf("@");
  if (atIndex >= 0) {
    candidate = candidate.slice(atIndex + 1);
  }
  if (candidate.includes("<")) {
    candidate = candidate.split("<")[0].trim();
  }
  if (candidate.includes("(")) {
    candidate = candidate.replace(/\([^)]*\)/g, "").trim();
  }
  if (candidate.includes(".")) {
    const domainPart = candidate.split("@").pop() || candidate;
    candidate = domainPart.split(".")[0];
  }
  candidate = candidate.replace(/[-_]/g, " ").trim();
  if (!candidate) return null;
  return capitalizeWords(candidate);
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parsePriceValue(value: any): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.,-]/g, "");
    if (!cleaned) return null;
    const numeric = Number.parseFloat(cleaned);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function normalizeCents(value: any): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.round(value);
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.,-]/g, "");
    if (!cleaned) return null;
    const numeric = Number.parseFloat(cleaned);
    if (!Number.isFinite(numeric)) return null;
    if (cleaned.includes(".")) {
      return Math.round(numeric * 100);
    }
    return Math.round(numeric);
  }
  return null;
}

function convertLineItems(items: any[]): NormalizedLineItem[] {
  return items
    .map((item) => {
      if (!item) return null;
      const name = (item.name || "").toString().trim();
      const sku = item.sku ?? item.id ?? null;
      let qty = Number(item.qty ?? 1);
      if (!Number.isFinite(qty) || qty <= 0) qty = 1;
      qty = Math.round(qty);

      const price = parsePriceValue(item.unit_price);
      let unitCents = normalizeCents(item.unit_cents);
      let unitPrice = price;
      if (unitPrice == null && unitCents != null) {
        unitPrice = unitCents / 100;
      } else if (unitPrice != null && unitCents == null) {
        unitCents = Math.round(unitPrice * 100);
      }

      if (!name && unitPrice == null && unitCents == null) {
        return null;
      }

      return {
        sku: sku ? String(sku) : null,
        name: name || "Item",
        qty,
        unit_price: unitPrice != null ? Number(unitPrice.toFixed(2)) : null,
        unit_cents: unitCents != null ? unitCents : null,
      } as NormalizedLineItem;
    })
    .filter((item): item is NormalizedLineItem => !!item);
}

function computeConfidence(input: {
  hasMerchant: boolean;
  hasOrderId: boolean;
  hasPurchaseDate: boolean;
  hasTotal: boolean;
  hasTax: boolean;
  hasShipping: boolean;
  hasItems: boolean;
  parseSource: ParseSourceType;
}): number {
  let score = 0;
  if (input.hasMerchant) score += 1;
  if (input.hasOrderId) score += 1;
  if (input.hasPurchaseDate) score += 1;
  if (input.hasTotal) score += 1;
  if (input.hasTax) score += 0.5;
  if (input.hasShipping) score += 0.5;
  if (input.hasItems) score += 0.5;
  let confidence = score / 4;
  if (input.parseSource === "rules" && confidence < 1) {
    confidence = Math.min(1, confidence + 0.1);
  }
  if (input.parseSource === "llm") {
    confidence = Math.min(confidence, 0.8);
  }
  confidence = Math.max(0.1, Math.min(1, confidence));
  return Number(confidence.toFixed(2));
}

function buildNormalizedReceipt(
  params: BuildReceiptParams
): NormalizedReceiptInsert | null {
  const merchantName = formatMerchantName(
    params.merchantValue,
    params.fallbackMerchant
  );
  const orderIdRaw = (params.orderId || "").toString().trim();
  const purchaseDateIso = normalizeDate(params.purchaseDate);
  const totalCents = normalizeCents(params.totalCents);
  const taxCents = normalizeCents(params.taxCents);
  const shippingCents = normalizeCents(params.shippingCents);
  const currency = (params.currency || "USD")
    .toString()
    .trim()
    .toUpperCase() || "USD";
  const lineItems = convertLineItems(params.items);

  if (!merchantName || !orderIdRaw || !purchaseDateIso || totalCents == null) {
    return null;
  }

  const totalAmount = Number((totalCents / 100).toFixed(2));
  const taxes = taxCents != null ? Number((taxCents / 100).toFixed(2)) : null;
  const shipping =
    shippingCents != null ? Number((shippingCents / 100).toFixed(2)) : null;

  const confidence = computeConfidence({
    hasMerchant: !!merchantName,
    hasOrderId: !!orderIdRaw,
    hasPurchaseDate: !!purchaseDateIso,
    hasTotal: totalCents != null,
    hasTax: taxCents != null,
    hasShipping: shippingCents != null,
    hasItems: lineItems.length > 0,
    parseSource: params.parseSource,
  });

  const merchantKey = merchantName.toLowerCase();
  const orderKey = orderIdRaw.toLowerCase();
  const dedupeKey = createHash("sha256")
    .update(
      `${params.userId}|${merchantKey}|${orderKey}|${purchaseDateIso}|${totalAmount.toFixed(
        2
      )}`
    )
    .digest("hex");

  const raw_json = {
    gmail: params.gmail,
    normalized: {
      merchant: merchantName,
      order_id: orderIdRaw,
      purchase_date: purchaseDateIso,
      currency,
      total_amount: totalAmount,
      taxes,
      shipping,
      line_items: lineItems.map((item) => ({
        sku: item.sku ?? null,
        name: item.name,
        qty: item.qty,
        unit_price: item.unit_price,
      })),
      email_message_id: params.emailMessageId,
      parse_source: params.parseSource,
      confidence,
      receipt_url: params.receiptLink,
    },
  };

  return {
    merchant: merchantName,
    order_id: orderIdRaw,
    purchase_date: purchaseDateIso,
    currency,
    total_amount: totalAmount,
    total_cents: totalCents,
    taxes,
    tax_cents: taxCents,
    shipping,
    shipping_cents: shippingCents,
    line_items: lineItems,
    email_message_id: params.emailMessageId,
    parse_source: params.parseSource,
    confidence,
    receipt_url: params.receiptLink,
    dedupe_key: dedupeKey,
    raw_json,
  };
}

class GmailReauthRequiredError extends Error {
  public readonly statusCode = 428;
  public readonly code = "reauth_required";
  public readonly requiredScopes = REQUIRED_WRITE_SCOPES;
  public readonly grantedScopes: string[];
  public userId?: string;

  constructor(grantedScopes: string[]) {
    super("Gmail reauthorization required");
    this.name = "GmailReauthRequiredError";
    const unique = Array.from(
      new Set(
        grantedScopes
          .map((scope) => (typeof scope === "string" ? scope.trim() : ""))
          .filter((scope) => scope.length > 0)
      )
    );
    this.grantedScopes = unique;
  }
}

function isInsufficientScopeError(err: any): boolean {
  if (!err) return false;
  const status = err?.code ?? err?.response?.status ?? err?.status;
  if (status !== 403) return false;

  const candidates: any[] = [];
  if (Array.isArray(err?.errors)) candidates.push(...err.errors);
  const apiErrors = err?.response?.data?.error?.errors;
  if (Array.isArray(apiErrors)) candidates.push(...apiErrors);
  if (
    candidates.some((item) => {
      const reason = (item?.reason || "").toString().toLowerCase();
      return reason.includes("insufficient") || reason.includes("permission");
    })
  ) {
    return true;
  }

  const errorStatus = (err?.response?.data?.error?.status || "")
    .toString()
    .toLowerCase();
  if (errorStatus === "permission_denied") {
    const message = (err?.response?.data?.error?.message || "")
      .toString()
      .toLowerCase();
    if (message.includes("insufficient") || message.includes("scope")) {
      return true;
    }
  }

  const message = (err?.message || err?.response?.data?.error?.message || "")
    .toString()
    .toLowerCase();
  return message.includes("insufficient") && message.includes("scope");
}

function maybeThrowReauth(err: any, gmail: any): void {
  if (!isInsufficientScopeError(err)) return;
  const grantedScopes = gatherAvailableScopes(gmail);
  throw new GmailReauthRequiredError(grantedScopes);
}

function gatherAvailableScopes(gmail: any): string[] {
  const scopeCandidates = [
    gmail?._options?.auth?.credentials?.scope,
    gmail?._options?.auth?.credentials?.scopes,
    gmail?._options?.auth?.credentials?.granted_scopes,
    gmail?._options?.auth?.scopes,
  ];
  const scopeSet = new Set<string>();
  for (const candidate of scopeCandidates) {
    if (!candidate) continue;
    if (Array.isArray(candidate)) {
      for (const scope of candidate) {
        if (typeof scope === "string" && scope.trim()) {
          scopeSet.add(scope.trim());
        }
      }
    } else if (typeof candidate === "string") {
      for (const scope of candidate.split(/\s+/)) {
        const trimmed = scope.trim();
        if (trimmed) scopeSet.add(trimmed);
      }
    }
  }
  return Array.from(scopeSet);
}

interface AnchorCandidate {
  href: string;
  text: string;
  score: number;
}

function hasReceiptIndicators(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  const keywordRegex = /(receipt|invoice|order|purchase|confirmation|payment)/i;
  const viewRegex = /view (?:your )?(?:order|receipt|invoice|purchase|details)/i;
  const idRegex =
    /(order|receipt|invoice|confirmation|transaction)[^\n]{0,20}(number|no\.?|#|id)?\s*[:#]?\s*[a-z0-9][a-z0-9-]{3,}/i;
  const amountRegex = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/;

  const hasKeyword = keywordRegex.test(text);
  const hasView = viewRegex.test(lower);
  const hasId = idRegex.test(text);
  const hasAmount = amountRegex.test(text);

  let score = 0;
  if (hasKeyword) score += 1;
  if (hasView) score += 1;
  if (hasId) score += 2;
  if (hasAmount) score += 2;

  return score >= 3 && hasAmount;
}

async function ensureProcessedLabel(gmail: any): Promise<string | null> {
  if (!LABELING_ENABLED) return null;
  const availableScopes = gatherAvailableScopes(gmail);
  if (availableScopes.length === 0) {
    console.info("[gmail] skipping processed label (unknown scopes)");
    return null;
  }
  const hasLabelCreationScope = availableScopes.some((scope) =>
    LABEL_CREATION_SCOPES.has(scope)
  );
  if (!hasLabelCreationScope) {
    console.info("[gmail] skipping processed label (missing label scope)");
    return null;
  }

  const lookup = async () => {
    const labelsResp: any = await withRetry(
      () => gmail.users.labels.list({ userId: "me" }),
      "users.labels.list"
    );
    const all = labelsResp?.data?.labels || [];
    const lowerName = PROCESSED_LABEL_NAME.toLowerCase();
    const match = all.find(
      (label: any) => (label.name || "").toLowerCase() === lowerName
    );
    return match?.id || null;
  };

  try {
    const existing = await lookup();
    if (existing) return existing;
  } catch (err) {
    maybeThrowReauth(err, gmail);
    console.warn("[gmail] labels.list failed", err);
  }

  try {
    const createdResp: any = await withRetry(
      () =>
        gmail.users.labels.create({
          userId: "me",
          requestBody: {
            name: PROCESSED_LABEL_NAME,
            labelListVisibility: "labelHide",
            messageListVisibility: "hide",
          },
        }),
      "users.labels.create"
    );
    const id = createdResp?.data?.id;
    if (id) return id;
  } catch (err) {
    maybeThrowReauth(err, gmail);
    const code = err?.code ?? err?.response?.status;
    if (code === 403) {
      const details =
        err?.errors?.[0]?.message ??
        err?.response?.data?.error?.message ??
        err?.message ??
        "insufficient permissions";
      console.warn(
        `[gmail] skipping processed label creation (${String(details)})`
      );
    } else {
      console.warn("[gmail] labels.create failed", err);
    }
  }

  try {
    return await lookup();
  } catch (err) {
    maybeThrowReauth(err, gmail);
    console.warn("[gmail] labels.list retry failed", err);
    return null;
  }
}

function b64ToBuf(b64: string): Buffer {
  const norm = b64.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(norm, "base64");
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function findPdfPart(part: any): any | null {
  if (!part) return null;
  if (part.mimeType === "application/pdf") return part;
  if (Array.isArray(part.parts)) {
    for (const p of part.parts) {
      const found = findPdfPart(p);
      if (found) return found;
    }
  }
  return null;
}

function findHtmlPart(part: any): any | null {
  if (!part) return null;
  if (part.mimeType === "text/html") return part;
  if (Array.isArray(part.parts)) {
    for (const p of part.parts) {
      const found = findHtmlPart(p);
      if (found) return found;
    }
  }
  return null;
}

function gatherAnchors(html: string): AnchorCandidate[] {
  const $ = load(html);
  const links: AnchorCandidate[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const text = $(el)
      .text()
      .replace(/\s+/g, " ")
      .trim();
    links.push({ href, text, score: 0 });
  });
  return links;
}

async function findReceiptLink(
  payload: any,
  from: string
): Promise<string | null> {
  const htmlPart = findHtmlPart(payload);
  const data = htmlPart?.body?.data;
  if (!data) return null;
  const html = b64ToBuf(data).toString("utf8");
  const links = gatherAnchors(html);
  if (links.length === 0) return null;
  const senderDomain = (from.match(/@([^>\s]+)/)?.[1] || "").toLowerCase();
  const keywordRegex = /(order|receipt|invoice|purchase|view|details)/i;
  const viewRegex = /view (?:your )?(?:order|receipt|invoice|details)/i;
  const idRegex =
    /(order|receipt|invoice|confirmation)[^\n]{0,20}[:#]?\s*[a-z0-9][a-z0-9-]{3,}/i;

  const scored = links
    .map((link) => {
      let domainMatch = false;
      let urlKeyword = false;
      let validUrl = false;
      try {
        const u = new URL(link.href);
        validUrl = u.protocol === "http:" || u.protocol === "https:";
        domainMatch =
          !!senderDomain && u.hostname.toLowerCase().endsWith(senderDomain);
        urlKeyword = keywordRegex.test(link.href);
      } catch {
        domainMatch = false;
      }
      const textKeyword = keywordRegex.test(link.text);
      const viewMatch = viewRegex.test(link.text.toLowerCase());
      const idMatch = idRegex.test(link.text);
      const score =
        (domainMatch ? 3 : 0) +
        (urlKeyword ? 2 : 0) +
        (textKeyword ? 3 : 0) +
        (viewMatch ? 3 : 0) +
        (idMatch ? 1 : 0);
      return {
        ...link,
        score,
        domainMatch,
        textKeyword,
        urlKeyword,
        viewMatch,
        validUrl,
      };
    })
    .filter(
      (link) =>
        link.validUrl &&
        (link.domainMatch || link.urlKeyword || link.textKeyword || link.viewMatch)
    );

  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 1) return scored[0].href;

  const candidates: ReceiptLinkCandidate[] = scored.map((link) => ({
    url: link.href,
    anchorText: link.text,
  }));

  const llmChoice = await extractReceiptLink(candidates);
  if (llmChoice) return llmChoice;
  return scored[0].href;
}

export async function fetchReceiptFromLink(
  url: string,
  meta?: {
    user_id?: string;
    message_id?: string;
    merchant?: string;
    subject?: string;
    from?: string;
  }
): Promise<ParsedReceipt | null> {
  try {
    const resp = await withRetry(
      () => fetch(url, { redirect: "manual" }),
      "fetch receipt link"
    );

    const status = resp.status;

    if (
      status === 401 ||
      status === 403 ||
      (status === 302 && /login|signin/i.test(resp.headers.get("location") || ""))
    ) {
      try {
        await supabaseAdmin.from("pending_receipts").insert([
          {
            url,
            user_id: meta?.user_id || null,
            message_id: meta?.message_id || null,
            merchant: meta?.merchant || null,
            subject: meta?.subject || null,
            from_header: meta?.from || null,
            status_code: status,
          },
        ]);
      } catch (e) {
        console.error("[pending_receipts] insert failed:", e);
      }
      console.warn(
        `[fetch-receipt-link] authentication required (${status}) for ${url}`
      );
      return null;
    }

    if (!resp.ok) {
      console.warn(`[fetch-receipt-link] failed (${status}) for ${url}`);
      return null;
    }

    const type = resp.headers.get("content-type") || "";
    if (type.includes("application/pdf")) {
      const buf = Buffer.from(await resp.arrayBuffer());
      return await parsePdf(buf);
    }
    if (type.includes("text/html")) {
      const html = await resp.text();
      const text = stripHtml(html);
      const host = (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return "";
        }
      })();
      let parsed = naiveParse(text, `no-reply@${host}`);
      const needsReceipt =
        !parsed.merchant ||
        parsed.merchant === "unknown" ||
        !parsed.order_id ||
        !parsed.purchase_date ||
        parsed.total_cents == null;
      if (needsReceipt) {
        const llm = await extractReceipt(text);
        if (llm) {
          if ((!parsed.merchant || parsed.merchant === "unknown") && llm.merchant)
            parsed.merchant = llm.merchant.toLowerCase();
          if (!parsed.order_id && llm.order_id) parsed.order_id = llm.order_id;
          if (!parsed.purchase_date && llm.purchase_date)
            parsed.purchase_date = llm.purchase_date;
          if (parsed.total_cents == null && llm.total_cents != null)
            parsed.total_cents = llm.total_cents;
          if ((llm as any).tax_cents != null)
            (parsed as any).tax_cents = (llm as any).tax_cents;
          if ((llm as any).shipping_cents != null)
            (parsed as any).shipping_cents = (llm as any).shipping_cents;
        }
      }
      return parsed;
    }
    return null;
  } catch (e) {
    console.error(`[fetch-receipt-link] error for ${url}:`, e);
    return null;
  }
}

function extractText(part: any): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) {
    return b64ToBuf(part.body.data).toString("utf8");
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return stripHtml(b64ToBuf(part.body.data).toString("utf8"));
  }
  if (Array.isArray(part.parts)) {
    return part.parts.map((p: any) => extractText(p)).join("\n");
  }
  return "";
}

async function isReceiptLLM(text: string): Promise<boolean> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return true;
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model:
          process.env.OPENAI_CLASSIFIER_MODEL ||
          process.env.OPENAI_RECEIPT_MODEL ||
          "gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You decide whether an email either contains a purchase receipt or clearly links to one. " +
              "Answer 'yes' when the message references an order, invoice, or purchase and includes strong signals such as " +
              "currency amounts (e.g., $23.45), order or receipt numbers, or buttons/links like 'View order' or 'View receipt'. " +
              "If the email is purely marketing, informational, or lacks purchase evidence, respond 'no'. Respond with exactly 'yes' or 'no'.",
          },
          {
            role: "user",
            content:
              "Subject: Happy Place Maps order confirmation\nBody: Thanks for your purchase! Order #HPM-12345\nTotal: $27.50\nButton: View Order",
          },
          { role: "assistant", content: "yes" },
          {
            role: "user",
            content:
              "Subject: Storage payment receipt\nBody: Receipt Number 67890\nTotal Paid: $88.00 USD\nBalance: $0.00",
          },
          { role: "assistant", content: "yes" },
          {
            role: "user",
            content:
              "Subject: Summer deals are here!\nBody: Save 20% on your next order. View our catalogue for more details.",
          },
          { role: "assistant", content: "no" },
          { role: "user", content: text.slice(0, 6000) },
        ],
        max_tokens: 1,
      }),
    });
    const data: any = await resp.json();
    const answer = data?.choices?.[0]?.message?.content?.toLowerCase() || "";
    return answer.includes("yes");
  } catch {
    return true;
  }
}

async function processMessage(
  gmail: any,
  userId: string,
  merchant: string,
  messageId: string,
  processedLabelId?: string | null
): Promise<boolean> {
  let shouldLabel = false;
  let markRead = false;
  let created = false;
  let full;
  try {
    full = await withRetry(
      () =>
        gmail.users.messages.get({
          userId: "me",
          id: messageId,
          format: "full",
        }),
      "users.messages.get"
    );
  } catch (err) {
    maybeThrowReauth(err, gmail);
    return false;
  }

  try {
    const payload = full.data.payload || {};
    const headers = payload.headers || [];
    const subject =
      headers.find((h: any) => (h.name || "").toLowerCase() === "subject")?.value || "";
    const from =
      headers.find((h: any) => (h.name || "").toLowerCase() === "from")?.value || "";

    const text = extractText(payload);
    const combined = `${subject}\n${text}`;
    const heuristicHit = hasReceiptIndicators(combined);
    let isReceipt = heuristicHit;
    if (!isReceipt) {
      isReceipt = await isReceiptLLM(combined);
    }
    if (!isReceipt) {
      shouldLabel = LABELING_ENABLED;
      return false;
    }

    shouldLabel = LABELING_ENABLED;
    markRead = true;
    let parsed: ParsedReceipt | null = null;
    let fromPdf = false;

    const pdfPart = findPdfPart(payload);
    if (pdfPart) {
      let buf: Buffer | null = null;
      if (pdfPart.body?.attachmentId) {
        try {
          const att = await gmail.users.messages.attachments.get({
            userId: "me",
            messageId,
            id: pdfPart.body.attachmentId,
          });
          const data = att?.data?.data as string | undefined;
          if (data) buf = b64ToBuf(data);
        } catch (err) {
          maybeThrowReauth(err, gmail);
          console.warn("[gmail] failed to load attachment", err);
        }
      } else if (pdfPart.body?.data) {
        buf = b64ToBuf(pdfPart.body.data);
      }
      if (buf) {
        parsed = await parsePdf(buf);
        fromPdf = true;
      }
    }

    if (!parsed) {
      parsed = naiveParse(combined, from);
    }

    let receiptLink: string | null = null;
    let merchantValue = (parsed as any)?.merchant ?? null;
    let orderId = (parsed as any)?.order_id ?? null;
    let purchaseDateRaw = (parsed as any)?.purchase_date ?? null;
    let totalCents = (parsed as any)?.total_cents ?? null;
    let taxCents = (parsed as any)?.tax_cents ?? null;
    let shippingCents = (parsed as any)?.shipping_cents ?? null;
    let currency = (parsed as any)?.currency ?? null;
    let items: any[] = Array.isArray((parsed as any)?.items)
      ? [...((parsed as any).items as any[])]
      : [];

    const essentialsMissing = () =>
      !merchantValue ||
      merchantValue === "unknown" ||
      !orderId ||
      !purchaseDateRaw ||
      totalCents == null;

    if (essentialsMissing()) {
      receiptLink = await findReceiptLink(payload, from);
      if (receiptLink) {
        (full.data as any).receipt_link = receiptLink;
        const linkParsed = await fetchReceiptFromLink(receiptLink, {
          user_id: userId,
          message_id: messageId,
          merchant: merchantValue || merchant,
          subject,
          from,
        });
        if (linkParsed) {
          if ((!merchantValue || merchantValue === "unknown") && linkParsed.merchant) {
            merchantValue = linkParsed.merchant;
            (parsed as any).merchant = linkParsed.merchant;
          }
          if (!orderId && linkParsed.order_id) {
            orderId = linkParsed.order_id;
            (parsed as any).order_id = linkParsed.order_id;
          }
          if (!purchaseDateRaw && linkParsed.purchase_date) {
            purchaseDateRaw = linkParsed.purchase_date;
            (parsed as any).purchase_date = linkParsed.purchase_date;
          }
          if (totalCents == null && linkParsed.total_cents != null) {
            totalCents = linkParsed.total_cents;
            (parsed as any).total_cents = linkParsed.total_cents;
          }
          if (taxCents == null && (linkParsed as any).tax_cents != null) {
            taxCents = (linkParsed as any).tax_cents;
            (parsed as any).tax_cents = (linkParsed as any).tax_cents;
          }
          if (shippingCents == null && (linkParsed as any).shipping_cents != null) {
            shippingCents = (linkParsed as any).shipping_cents;
            (parsed as any).shipping_cents = (linkParsed as any).shipping_cents;
          }
          if (!currency && (linkParsed as any).currency) {
            currency = (linkParsed as any).currency;
          }
          if (Array.isArray((linkParsed as any).items) && (linkParsed as any).items.length > 0) {
            items = (linkParsed as any).items;
            (parsed as any).items = items;
          }
        }
      }
    }

    let usedLLM = false;
    if (essentialsMissing()) {
      const excerpt = (parsed as any).text_excerpt;
      const llmText = [subject, combined, excerpt].filter(Boolean).join("\n\n");
      const llm = await extractReceipt(llmText);
      if (llm) {
        usedLLM = true;
        if ((!merchantValue || merchantValue === "unknown") && llm.merchant) {
          merchantValue = llm.merchant;
        }
        if (!orderId && llm.order_id) orderId = llm.order_id;
        if (!purchaseDateRaw && llm.purchase_date) purchaseDateRaw = llm.purchase_date;
        if (totalCents == null && llm.total_cents != null) totalCents = llm.total_cents;
        if (taxCents == null && llm.tax_cents != null) taxCents = llm.tax_cents;
        if (shippingCents == null && llm.shipping_cents != null)
          shippingCents = llm.shipping_cents;
        if (!currency && (llm as any).currency) currency = (llm as any).currency;
        if (Array.isArray((llm as any).items) && items.length === 0) {
          items = (llm as any).items;
        }
      }
    }

    const merchantForLog = merchantValue || merchant || "unknown";
    await logParseResult({
      parser: fromPdf ? "pdf" : "naive",
      merchant: merchantForLog,
      order_id_found: !!orderId,
      purchase_date_found: !!purchaseDateRaw,
      total_cents_found: totalCents != null,
    });

    const normalized = buildNormalizedReceipt({
      userId,
      merchantValue,
      fallbackMerchant: merchant,
      orderId,
      purchaseDate: purchaseDateRaw,
      totalCents,
      taxCents,
      shippingCents,
      currency,
      items,
      emailMessageId: messageId,
      parseSource: usedLLM ? "llm" : "rules",
      receiptLink,
      gmail: full.data,
    });

    if (!normalized) {
      return false;
    }

    const existingQuery = await supabaseAdmin
      .from("receipts")
      .select("id")
      .eq("user_id", userId)
      .eq("dedupe_key", normalized.dedupe_key)
      .maybeSingle();
    if (existingQuery.error) {
      throw existingQuery.error;
    }
    const existingRow = existingQuery.data;

    const upsertResult = await supabaseAdmin
      .from("receipts")
      .upsert(
        [
          {
            user_id: userId,
            merchant: normalized.merchant,
            order_id: normalized.order_id,
            purchase_date: normalized.purchase_date,
            currency: normalized.currency,
            total_cents: normalized.total_cents,
            tax_cents: normalized.tax_cents,
            shipping_cents: normalized.shipping_cents,
            source: "gmail",
            email_message_id: normalized.email_message_id,
            parse_source: normalized.parse_source,
            confidence: normalized.confidence,
            receipt_url: normalized.receipt_url,
            raw_json: normalized.raw_json,
            dedupe_key: normalized.dedupe_key,
          },
        ],
        { onConflict: "dedupe_key" }
      )
      .select("id")
      .single();

    const receiptId = upsertResult.data?.id || existingRow?.id || null;

    if (receiptId) {
      await supabaseAdmin.from("line_items").delete().eq("receipt_id", receiptId);
      if (normalized.line_items.length > 0) {
        const payloadItems = normalized.line_items.map((item) => ({
          receipt_id: receiptId,
          name: item.name,
          qty: item.qty,
          unit_cents: item.unit_cents,
          sku: item.sku ?? null,
        }));
        const insertItems = await supabaseAdmin
          .from("line_items")
          .insert(payloadItems);
        if (insertItems.error && /column "sku"/i.test(insertItems.error.message || "")) {
          const fallbackPayload = payloadItems.map(({ sku, ...rest }) => rest);
          await supabaseAdmin.from("line_items").insert(fallbackPayload);
        }
      }
    }

    if (!existingRow && receiptId) {
      console.info("[gmail][ingest]", {
        event: "receipt_created",
        user_id: userId,
        merchant: normalized.merchant,
        count: 1,
      });
      created = true;
    }
  } finally {
    await modifyMessageLabels(
      gmail,
      messageId,
      processedLabelId ?? null,
      markRead,
      shouldLabel
    );
  }
  return created;
}

async function modifyMessageLabels(
  gmail: any,
  messageId: string,
  processedLabelId: string | null,
  markRead: boolean,
  shouldLabel: boolean
) {
  const shouldModify = markRead || (shouldLabel && processedLabelId);
  if (!shouldModify) return;
  const availableScopes = gatherAvailableScopes(gmail);
  const canModify = availableScopes.some((scope) => MODIFY_SCOPES.has(scope));
  if (!canModify) {
    console.warn(
      "[gmail] skipping label modifications (missing modify scope)",
      messageId
    );
    return;
  }
  const requestBody: Record<string, any> = {};
  if (markRead) requestBody.removeLabelIds = ["UNREAD"];
  if (shouldLabel && processedLabelId) requestBody.addLabelIds = [processedLabelId];
  if (Object.keys(requestBody).length === 0) return;
  try {
    await gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody,
    });
  } catch (err) {
    maybeThrowReauth(err, gmail);
    console.warn("[gmail] failed to modify labels", err);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET,POST");
    return res.status(405).end();
  }

  try {
    const userFilter = (req.query.user as string) || "";
    let query = supabaseAdmin
      .from("approved_merchants")
      .select("user_id, merchant");
    if (userFilter) query = query.eq("user_id", userFilter);
    const { data, error } = await query;

    if (error || !data) {
      return res.status(500).json({ ok: false, error: error?.message });
    }

    const processedLabelCache = new Map<string, string | null>();
    const byUser = new Map<string, string[]>();

    for (const row of data) {
      const userId = row.user_id as string;
      const merchant = row.merchant as string;
      if (!userId || !merchant) continue;
      const list = byUser.get(userId);
      if (list) {
        list.push(merchant);
      } else {
        byUser.set(userId, [merchant]);
      }
    }

    const dateStr = computeSinceDate(
      process.env.GMAIL_INGEST_MONTHS || process.env.GMAIL_DISCOVERY_MONTHS
    );

    for (const [userId, merchantList] of byUser) {
      const tokens = await getAccessToken(userId);
      if (!tokens) continue;

      if (tokens.status && tokens.status.toLowerCase() === "reauth_required") {
        const err = new GmailReauthRequiredError(tokens.grantedScopes || []);
        err.userId = userId;
        throw err;
      }

      const gmail = google.gmail({ version: "v1", auth: tokens.client });

      try {
        let processedLabelId = processedLabelCache.get(userId);
        if (processedLabelId === undefined) {
          processedLabelId = await ensureProcessedLabel(gmail);
          processedLabelCache.set(userId, processedLabelId ?? null);
        }

        const uniqueMerchants = Array.from(new Set(merchantList));
        console.info("[gmail][ingest]", {
          event: "scan_started",
          user_id: userId,
          merchants: uniqueMerchants.length,
        });

        for (const merchant of uniqueMerchants) {
          const domains = getMerchantDomains(merchant);
          const fromTokens = buildFromTokens(merchant, domains);
          if (fromTokens.length === 0) continue;

          const fromClause = `from:(${fromTokens.join(" OR ")})`;
          const primaryParts = [
            fromClause,
            SMARTLABEL_CLAUSE,
            BASE_SUBJECT_QUERY,
            `after:${dateStr}`,
          ];
          const fallbackParts = [
            fromClause,
            UPDATES_CLAUSE,
            BASE_SUBJECT_QUERY,
            `after:${dateStr}`,
          ];
          if (processedLabelId) {
            primaryParts.push(`-label:${PROCESSED_LABEL_NAME}`);
            fallbackParts.push(`-label:${PROCESSED_LABEL_NAME}`);
          }

          const qPrimary = primaryParts.join(" ");
          const qFallback = fallbackParts.join(" ");

          const primaryIds = await searchMessageIds(gmail, qPrimary);
          const messageIdSet = new Set(primaryIds);
          const messageIds = [...primaryIds];

          if (primaryIds.length < PRIMARY_RESULT_THRESHOLD) {
            const fallbackIds = await searchMessageIds(gmail, qFallback);
            for (const id of fallbackIds) {
              if (!messageIdSet.has(id)) {
                messageIdSet.add(id);
                messageIds.push(id);
              }
            }
          }

          for (const id of messageIds) {
            if (!id) continue;
            try {
              await processMessage(gmail, userId, merchant, id, processedLabelId);
            } catch (err) {
              if (err instanceof GmailReauthRequiredError) {
                err.userId = userId;
              }
              throw err;
            }
          }
        }
      } catch (err) {
        if (err instanceof GmailReauthRequiredError) {
          err.userId = userId;
        }
        throw err;
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    if (err instanceof GmailReauthRequiredError) {
      if (err.userId) {
        try {
          await supabaseAdmin
            .from("gmail_tokens")
            .update({
              status: "reauth_required",
              reauth_required: true,
              granted_scopes: err.grantedScopes,
            })
            .eq("user_id", err.userId);
        } catch (updateErr) {
          console.error("[gmail] failed to flag reauth requirement", updateErr);
        }
      }
      return res.status(err.statusCode).json({
        ok: false,
        code: err.code,
        requiredScopes: err.requiredScopes,
        grantedScopes: err.grantedScopes,
      });
    }
    console.error("[gmail] ingest failed", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
}

