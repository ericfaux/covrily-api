# GitHub Code Documentation

This document describes the purpose of each file in the repository (excluding the `covrily-context-docs` folder).

## Root Files
- **.gitignore** – ignores dependencies, build outputs, logs and environment files.
- **package.json** – project metadata and dependencies such as `@supabase/supabase-js`, `pdf-parse` and `cheerio`.
- **tsconfig.json** – TypeScript configuration targeting ES2020 with NodeNext modules.
- **vercel.json** – Vercel deployment config defining cron schedules for API jobs.

## lib
- **decision-engine.ts** – computes whether to keep, return or request a price adjustment based on merchant policies.
  ```ts
  const preview = previewDecision(
    { merchant: "bestbuy.com", purchase_date: "2024-05-01", total_cents: 9999 },
    new Date(),
    { current_price_cents: 8999 }
  );
  console.log(preview.suggestion); // "price_adjust"
  ```
- **llm/extract-receipt.ts** – uses OpenAI to extract receipt fields (merchant, order ID, totals) from plain text.
  ```ts
  const structured = await extractReceipt(emailText);
  ```
- **mail.ts** – sends emails through Postmark with optional debug routing.
  ```ts
  await sendMail("user@example.com", "Subject", "Body");
  ```
- **parse-log.ts** – records parser outcomes in the `parse_logs` table and logs them.
- **parse.ts** – naive text-based receipt parser that infers merchant, order ID, purchase date and total.
- **pdf.ts** – parses PDF receipts, delegating to merchant-specific parsers when possible (`parsers/hm`, `parsers/bestbuy`, `parsers/walmart`).
  ```ts
  const buf = fs.readFileSync("receipt.pdf");
  const parsed = await parsePdf(buf);
  ```
- **parsers/bestbuy.ts, parsers/hm.ts, parsers/walmart.ts** – extract receipt fields from merchant-specific PDF formats.
- **policies.ts** – simplified return and price-adjust rules for known merchants; exposes `getPolicy`.
- **postmark.ts** – minimal Postmark wrapper used for development email tests.
- **price-parsers.ts** – heuristically pulls product prices from HTML pages.
- **supabase-admin.ts** – creates a Supabase service-role client for server-side operations.

## api
### admin
- **admin/csv.ts** – exports a user's receipts as CSV.
  ```
  GET /api/admin/csv?user=<uuid>
  Header: x-admin-token: <ADMIN_TOKEN>
  ```
- **admin/html.ts** – simple HTML dashboard listing a user's receipts and deadlines (`?debug=1` shows sample data).
- **admin/parse-stats.ts** – summarizes parse success/failure counts per merchant from `parse_logs`.
- **admin/pdf-ui.ts** – HTML UI to parse an H&M receipt PDF by URL and optionally save it.
- **admin/receipts.ts** – lists recent receipts with optional search filters.
- **admin/recent.ts** – returns recent receipts and their first product link for the admin UI.
- **admin/ui.ts** – full admin dashboard to inspect receipts, manage links, preview policies and trigger price checks.

### cron
- **cron/due-today.ts** – daily reminder emails for deadlines due within 24 hours.
- **cron/heads-up.ts** – emails heads-up notices for deadlines due in ~7 days.
- **cron/price-watch.ts** – nightly job that fetches product pages, logs prices and emails users about drops.
- **cron/purge-inbound.ts** – weekly cleanup of `inbound_emails` older than 30 days.

### decisions
- **decisions/index.ts** – admin endpoint to list or create decision records for a receipt.
  ```
  GET  /api/decisions?receipt_id=<id>&action=list
  POST /api/decisions { "receipt_id": "...", "decision": "keep" }
  ```

### dev & diag
- **dev/send-test.ts** – sends a test email through Postmark.
- **diag/env.ts** – reports environment variable presence and DB connectivity when authorized.
- **health.ts** – authenticated health check returning the current timestamp.

### inbound
- **inbound/postmark.ts** – webhook for Postmark inbound emails; parses PDF attachments or text/LLM to upsert receipts and log parse results.
- **inbound/postmark.test.ts** – Node tests verifying the inbound handler’s PDF decoding logic.

### me (user-facing)
- **me/deadlines.ts** – lists deadlines for a user.
  ```
  GET /api/me/deadlines?user=<uuid>
  ```
- **me/decide.ts** – allows a user to keep, return or reopen a deadline via POST.
  ```
  POST /api/me/decide { id, user, action: "keep" }
  ```
- **me/receipts.ts** – returns receipts belonging to a user.
- **me/summary.ts** – summary counts of receipts and decisions for a user.

### policy
- **policy/preview.ts** – previews policy-based suggestions for a receipt, optionally with a current price.

### price
- **price-check.ts** – admin endpoint to evaluate a price drop for a receipt and optionally email the user.
- **price/link.ts** – admin endpoint to get or upsert a product link for a receipt.
  ```
  GET /api/price/link?receipt_id=<id>&action=get
  GET /api/price/link?receipt_id=<id>&action=upsert&url=<product-url>&merchant_hint=Best%20Buy
  ```
- **price/observations.ts** – returns logged price observations for a receipt.

### receipts
- **receipts/index.ts** – fetches full receipt details, including tax and shipping.

## Deployment
- **vercel.json** – defines cron schedules:
  - `/api/cron/due-today` at 14:00 UTC daily
  - `/api/cron/heads-up` at 14:05 UTC daily
  - `/api/cron/purge-inbound` at 03:00 UTC Mondays
  - `/api/cron/price-watch` at 02:00 UTC daily
