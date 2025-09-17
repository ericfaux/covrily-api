# AGENT GUIDE — Covrily API

> Read this before making any change with Codex/Copilot/Cursor or similar AI agents.

## What Covrily is (one‑pager)

Covrily is a post‑purchase copilot. We ingest receipts from email, extract items and order metadata, compute policy deadlines (returns, price adjustments, warranties), and trigger user wins (nudges, claims). MVP focuses on email receipts; later we add photo uploads. See `covrily-context-docs/overview.md` for context.

**North star:** money/value recovered per user + losses avoided.

---

## Source of truth — context docs

* Product overview: `covrily-context-docs/overview.md`
* DB schema (reference): `covrily-context-docs/Supabase_db.sql`
* Indexes: `covrily-context-docs/add_indexes.sql`
* Tooling & envs (names only; never commit values): `covrily-context-docs/tool_stack.md`

> If a doc contradicts code, prefer code + migrations; update docs in the same PR.

---

## Working agreements (must follow)

1. **Explain before code:** In your PR description and in the response to the requester, list each edited file and a one‑line purpose for the change.
2. **Comment inside code:** Add brief comments for non‑obvious logic, assumptions, and security decisions.
3. **Environment variables:** If a new Vercel env var is needed, **call it out explicitly** in your response. Provide the *name* and purpose only; never include secret values. Confirm with the requester before relying on it.
4. **Schema changes:** If any new table/column/index is needed, add SQL to `covrily-context-docs/Supabase_db.sql` (and indexes to `add_indexes.sql`) and note that it must be applied in Supabase.
5. **Least privilege:** Prefer read/metadata scopes for discovery; write operations must be guarded by feature flags and scope checks.
6. **Idempotency & safety:** Handlers must be idempotent; add retries/backoff on 429/5xx; never log PII or tokens.

---

## Output format (what to return)

1. **Full files with path headers** (no partial diffs), like:

```
// PATH: api/gmail/ingest.ts
<entire file content>
```

2. **Tests:** Add/adjust Jest tests for new logic. No network calls; use fakes/mocks.
3. **Run & Test section:** Provide exact commands to run build, lint, and tests.
4. **Self‑check:** A short bullet list of what you verified locally.

---

## Repo constraints & quality bars

* **Language:** TypeScript strict. ESLint + Prettier pass required.
* **APIs:** Don’t change public endpoint shapes without approval. Add new endpoints under `/api/...` and export pure helpers in `/lib/...`.
* **Observability:** Use structured logs (hinted objects) and include correlation identifiers (user id, job id) where appropriate.
* **Data protection:** Use RLS on tables (server‑side only access). Purge raw email bodies after the configured retention window once parsed.

---

## Gmail ingestion rules of engagement

* **Discovery (headers‑only):** Use Gmail search queries with `label:^smartlabel_receipt` **OR** `category:updates` plus subject tokens to find candidate receipts. Use `format="metadata"` and read only `From/Subject/Date`.
* **Consent:** Only scan bodies for merchants the user approved.
* **Selective scan:** For approved merchants, query again, then fetch `format="full"` for parsing. **Do not write Gmail labels** unless `GMAIL_LABELING_ENABLED === "true"` *and* token has write scopes.
* **Reauth:** If Google returns `insufficient_scope`, surface `HTTP 428 { code:"reauth_required" }` and provide a re‑link URL.

---

## Parser policy

* **Order:** try merchant rules first; fallback to LLM for long tail.
* **Output JSON:** `{ merchant, order_id, purchase_date, currency, total_amount, taxes?, shipping?, line_items:[{name, qty, unit_price, sku?}], email_message_id, parse_source:"rules|llm", confidence }`.
* **Dedupe key:** hash of `(user_id|merchant|order_id|purchase_date|total_amount)`.
* **Persist:** Upsert into `public.receipts` and `public.line_items`; create deadlines via the policy engine.

---

## Env vars (names only)

* Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RECEIPTS_BUCKET`.
* Gmail: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`, optional flags `GMAIL_LABELING_ENABLED`, `GMAIL_DISCOVERY_MONTHS`.
* LLM: `OPENAI_API_KEY`, `LLM_RECEIPT_ENABLED`.
* Email infra: Postmark tokens/from address.

> Always confirm any new env var with the requester before using it. Never print or commit secret values.

---

## Definition of Done (DoD)

* Build, lint, and tests pass locally.
* For each changed file, a brief comment at the top states **assumptions** and any notable **trade‑offs**.
* If a schema or env change exists, the PR includes the SQL in `covrily-context-docs/Supabase_db.sql` (and indexes in `add_indexes.sql`) and a note to run it.
* Logs show no PII and include useful context.

---

## Prompt prelude (paste this atop Codex requests)

```
You are pair‑programming on Covrily’s TypeScript API.
If something is missing, stop and list **Gaps**.
Follow AGENT.md rules. Return full files with `// PATH:` headers and Jest tests.
No network in tests; use fakes. Keep logs free of PII and secrets.
If a new env var or DB change is required, state it and add SQL to the schema files.
```

---

## Common tasks (micro‑briefs)

* **Gmail discovery update:** adjust query and heuristics in `lib/gmail-scan.ts` to use smartlabel + fallback; keep discovery metadata‑only.
* **Reauth flow:** add `/connectors/gmail/reauthorize` (force consent) and surface 428 from Gmail write attempts.
* **Parser rule add:** create a new merchant parser under `/lib/parsers/<merchant>.ts` with unit tests; ensure LLM fallback remains intact.
* **Indexing:** when adding frequent receipt/deadline queries, add supporting indexes to `add_indexes.sql` and reference them in PR notes.

---

## What not to do

* Don’t invent files or paths not listed in the request.
* Don’t commit secrets or print tokens.
* Don’t fetch email bodies during discovery.
* Don’t broaden OAuth scopes without adding scope checks and a reauth path.

---

## Contact / ownership

* Product & acceptance: Requester (project owner)
* Security & privacy: follow the guidelines above; escalate any uncertainty before merging.
