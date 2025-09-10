0) North Star & guardrails

North Star: “Money/Value Recovered per user” (refunds, price adjustments, returns made on time, approved warranty claims).

Launch target (90 days):

100–200 beta users with ≥30% achieving ≥1 “win” in 14 days, ≥3% free→paid (or ≥35% trial→paid if we use a trial), monthly churn ≤12% early‑cohort.

Run‑rate infra ≤ $150/mo at 500 MAU; all in monthly (incl. LLM/OCR) ≤ $330/mo on conservative settings; breakeven at ~25–70 paying users.

Positioning: The post‑purchase copilot that auto‑organizes receipts, computes return/price‑adjust windows, drafts claim/price‑adjust emails, registers warranties, and flags recalls—cross‑merchant, policy‑aware, action‑oriented.

1) Architecture baseline (stays lean)

Client: React Native (Expo) mobile app + minimal web (admin & webhook views).

Backend: Vercel serverless endpoints (or Workers), Supabase (Auth/Postgres/RLS), object storage (R2/S3).

Email: Postmark (inbound + transactional).

Parsing: HTML→rule parsers with LLM fallback; PDF/image→OCR + normalize.

Observability: Sentry + PostHog.

Security/Compliance: RLS, KMS‑managed secrets, GDPR/CCPA self‑service export/delete; plan for Gmail restricted‑scope verification only when needed.

2) Delivery plan (90 days)
Phase A — “Thin Slice” (Weeks 1–3)

Goal: Parse receipts end‑to‑end, compute deadlines, and prove reminder emails.

Workstreams & deliverables

Inbound pipeline (email → receipt):

Postmark inbound webhook → api/inbound/postmark handler.

Normalize payload; extract fields (merchant, order_id, purchase_date, total, tax, line items).

DB upserts into receipts, line_items; create deadlines via policy engine.

Acceptance:

10 seeded receipts across Best Buy, Target, Walmart, Amazon parse with ≥95% accuracy on merchant/date/total; de‑dupe by (user_id, merchant, order_id, purchase_date).

Policy engine (returns + price‑adjust windows v1):

Rules for 6 launch retailers (Best Buy, Target, Walmart, Amazon, Home Depot, Costco).

Acceptance: For known rules, deadline.type=return computed correctly; unknown stores flagged policy=unknown.

Notifications MVP (cron):

api/cron/due-today + vercel.json schedules; send “due today” & “one‑week ahead”.

Mail helper lib/mail.ts.

Indexes: deadlines_due_at_idx, receipts_id_user_idx.

Acceptance: Hitting /api/cron/due-today returns { ok:true, sent_today:N, sent_week_ahead:M }; last_notified_at is stamped; mail arrives.

Admin QA tools:

/api/admin/csv?user=<uuid> to export receipts.

/api/diag/env & /api/health endpoints gated by x-admin-token.

Acceptance: CSV download works; env/health show 200 and expected fields.

Owner(s): You (PM/IC), 1 full‑stack dev.
Risk: Email scope verification—not required yet because we launch with forward‑to‑alias; avoid Gmail OAuth until verified.

Phase B — “Win Engine” (Weeks 4–6)

Goal: Users experience recurring, measurable “wins”.

Workstreams & deliverables

Price‑adjust finder (same‑store, conservative):

For supported retailers, nightly check current price for items bought in last X days; if lower by ≥Y%, create “Draft price‑adjust email” action.

Acceptance: At least one triggered delta on sample data; draft email populated with order #, SKU/title, paid vs current price.

Claim copilot (templates):

Template spec (inputs/outputs) + generated email/PDF for: price‑adjust request, warranty claim (simple brands), return RMA checklist.

Acceptance: Draft artifacts open‑able, copy/paste friendly, and store to history.

Mobile skeleton (Expo):

Screens: Home (inbox cards), Receipt Detail (items, deadlines), Alerts feed, Paywall (free 10 items; Plus $4.99/mo or $39/yr).

Acceptance: First “win” walkthrough < 10 taps; paywall gating works.

Recalls MVP:

CPSC recall matcher by brand/category; link to action page.

Acceptance: Sample product yields a recall notification with next steps.

Phase C — “Polish & Beta” (Weeks 7–10)

Goal: 100–200 external users, telemetry, and payment flow.

Telemetry: PostHog funnels—receipt_ingested, policy_applied, deadline_created, price_drop_found, claim_drafted, win_realized, subscribe, cancel.

Payments: App Store/Play IAP + Stripe web checkout (annual bias).

SEO seed: 30 programmatic pages for “[Store] return/price‑adjust policy”, “[Brand] warranty claim template” with calculators/examples.

Support loop: Concierge queue (optional) for tough receipts; structured failure reasons.

Acceptance: ≥60% of beta users see ≥1 deadline; ≥25% experience ≥1 “win” in 14 days; ≥3% free→paid or ≥35% trial→paid.

Phase D — “GA Prep” (Weeks 11–13)

Goal: Launch checklist & reliability.

Hardening: Dedup guardrails, backoff/retry; Sentry error budgets; rate limits on webhooks.

Privacy & retention: Default purge of raw email bodies within 7–30 days post‑parse; structured fields + PDFs retained per policy.

Store submissions: App Store/Play metadata, screenshots, privacy nutrition, TOS/PP.

Acceptance: 2 consecutive weeks under error SLOs; app review approved; ready to switch on paid.

3) Backlog: epics & first tickets

Below are “grab‑and‑go” tickets for your dev:

EPIC: Inbound & Parse

Implement Postmark → /api/inbound/postmark (guard headers; tolerate missing fields).

Parser: HTML normalize → rules per merchant → LLM fallback (few‑shot).

De‑dupe: (user_id, merchant, order_id, purchase_date); default empty order_id if absent.

EPIC: Policy Engine

Rules schema (JSON/YAML) with carve‑outs by category.

Implement returns windows for 6 retailers; add price‑adjust windows.

EPIC: Cron & Email

lib/mail.ts + POSTMARK_TOKEN/POSTMARK_FROM env.

/api/cron/due-today + vercel.json schedule; indexes.

EPIC: Mobile UX

Home, Receipt Detail, Alerts, Paywall; sample data mode; deep links to receipts.

EPIC: Analytics & Paywall

PostHog events; subscription flow; “proof‑of‑value” paywall copy.


4) Scorecard (track monthly)

Activation: install → first parsed receipt (%), TTFV ≤ 15 min.

Wins: % users with ≥1 “win” in 14 days; average $ saved per active.

Conversion: free→paid (or trial→paid), annual mix.

Retention: monthly churn ≤10–12% by month 6; reactivations/month.

Cost: tokens/receipt, OCR hit rate; all‑in COGS ≤ $330/mo at 500 MAU.

5) Risks & mitigations (short list)

Gmail restricted scopes (if/when adding OAuth): requires Google‑approved annual security assessment; launch with forward‑to‑alias to avoid delay; add OAuth after verification.

Policy churn: set up a rules CMS and weekly update cadence; accept “unknown” gracefully.

Edge‑case parsing: concierge fallback; track failure patterns to add rules.

Notification fatigue: stamp last_notified_at, cap cadence, batch per‑merchant.

6) Budget snapshot (hand to finance)

Up‑front accounts: $150–$480 (Apple Dev / Play Console / domain / legal).

Build: $0–$3k (in‑house) or $5k–$20k (freelancers).

Run @ 500 MAU: ~$90–$330/mo (infra + LLM/OCR).

Revenue @ $4.99: 5k payers ≈ $21.2k net MRR (after ~15% store fee).

7) Go/No‑Go checklist

 Cron sends and stamps last_notified_at (no duplicates).

 ≥95% merchant/date/total accuracy on top‑20 retailers; ≥80% line‑item capture on launch stores.

 “Draft price‑adjust email” works on at least one real price drop.

 Privacy & retention policies live; data export/delete tested.

 App Store/Play approvals; paywall flows tested on device.

 Support runbooks; on‑call rotation; Sentry alerting tuned.

8) First 10 retailer/brand targets (v1 rules)

Best Buy, Target, Walmart, Amazon, Home Depot, Costco, Apple, Samsung, LG, Dyson (mix of retailer returns + brand warranty).

Add 2/week post‑launch; each rule PR should include 3 real receipt fixtures and acceptance tests.
