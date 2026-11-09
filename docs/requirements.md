# Synoptic: System Requirements

Status: draft v0.2 · Owner: Vikram · Stack: Next.js (Vercel) + Supabase (Postgres/Auth) + querying.ai

## 1. Purpose

Synoptic monitors how a client's brand and website appear in answers from AI engines (GEO / AI visibility). It asks a saved set of prompts to multiple engines on a schedule, stores the answers and cited sources, and shows visibility and citation trends over time.

## 2. Users and roles

| Role | Description |
| - | - |
| **Operator (agency admin)** | Owns the account. Creates workspaces for clients, manages prompts, schedules, budgets and users. |
| **Analyst** | Operator staff. Can edit projects and run scans for assigned clients. |
| **Client viewer** | **View only.** Read-only access to their own workspace's dashboards. Cannot edit prompts, schedules, projects or run scans. |

Tenancy model: one **agency account** contains many **client workspaces**, each with one or more **projects** (a brand + domain). A project is monitored in one or more **markets** (a country).

## 3. Scope

### MVP (release 1)
1. Scheduled monitoring: recurring scans of saved prompts, with history and trends.
2. Source and citation analysis: which domains and pages the engines cite.
3. Agency basics: auth, client workspaces, roles.

### Deferred (release 2+)
Competitor share-of-voice benchmarking (competitor names are captured in the MVP data model but only lightly used), alerts (email/Slack), PDF/CSV reports and white-label sharing, prompt suggestions (querying.ai Prompt Research), billing for clients, sentiment scoring.

### Out of scope
White-label / custom branding (every page carries Vimi branding); non-English prompts and UI in the MVP; client-side billing; building or hosting our own AI-engine scrapers (querying.ai provides them); SEO rank tracking; content generation.

## 4. Functional requirements

IDs: **M** = MVP, **L** = later.

### 4.1 Accounts, workspaces and access
- **FR-1 (M)** Email/password or magic-link login (Supabase Auth); Google SSO optional.
- **FR-2 (M)** Agency account with invite flow for staff and client viewers.
- **FR-3 (M)** Create/edit/archive client workspaces and projects (brand name, domain, aliases, country).
- **FR-4 (M)** Role-based access; a client viewer sees only their workspace and has read-only permission. Enforced in the database (RLS), not just the UI.
- **FR-4a (M)** All pages, including client-facing dashboards and any exports, carry **Vimi branding** (logo, colours, name). Branding is a single theme module so it can be updated in one place.

### 4.2 Project and prompt setup
- **FR-5 (M)** Define brand name plus aliases/misspellings and one or more domains (including subdomains) per project.
- **FR-6 (M)** Manage a prompt library per project: add, edit, bulk import (CSV/paste), tag, activate/pause.
- **FR-7 (M)** Select engines per project from the engines querying.ai supports: ChatGPT, Gemini, Perplexity, Copilot, Google AI Overviews, Google AI Mode, Meta AI (more later).
- **FR-8 (M)** **Markets:** a project can be monitored in multiple countries. Each market has its own prompt activation and results. MVP launch regions: **GCC** (AE, SA, QA, KW, BH, OM) and **Southeast Asia** (SG, MY, TH, ID, PH, VN), plus US as a baseline. Country is sent to querying.ai per task (ISO code); the country list is configuration, not code.
- **FR-8a (M)** **English only in the MVP** for prompts, answers analysed and UI. Data model and UI must be i18n-ready (UTF-8 everywhere, RTL-capable layout, brand aliases in other scripts such as Arabic or Thai) so local languages can be added later without migration.
- **FR-9 (M)** Track competitors (names/domains) per project.

### 4.3 Scanning and scheduling
- **FR-10 (M)** Schedules per project: daily, weekly, or manual "run now". **Each scan runs every prompt once per engine per market** (no automatic repeats); further runs are triggered manually or by schedule as the operator decides.
- **FR-11 (M)** A scan expands into one task per prompt × engine and submits to querying.ai; results are collected asynchronously (webhook primary, polling as recovery).
- **FR-12 (M)** Scan and task status visible in the UI (queued, running, completed, failed, partial) with per-task error reasons.
- **FR-13 (M)** Automatic retry of transient failures; idempotent submission so a retried job never double-charges.
- **FR-14 (M)** Cost controls: the **agency pays** through one master querying.ai key; usage is attributed to workspace, project and market. Estimate credits before a scan (prompts × engines × markets), set per-project and per-workspace monthly budgets, hard stop when exceeded.
- **FR-15 (M)** Full raw answer text and sources stored for every task (querying.ai results are retrievable for only 24 hours). **Retained permanently**; there is no automatic expiry.

### 4.4 Analysis
- **FR-16 (M)** Per answer: brand mentioned (name, alias or domain), position among tracked brands, domain cited.
- **FR-17 (M)** Metrics per project/engine/prompt/period: mention rate, citation rate, average rank.
- **FR-18 (M)** Source and citation analysis: top cited domains and URLs overall and per engine; which of the client's pages are cited; competitor domains cited; frequency over time.
- **FR-19 (M)** Trend charts with date range and engine filters; change versus previous period.
- **FR-20 (M)** Drill-down from a metric to the underlying prompts and full answers.
- **FR-21 (L)** Share of voice versus competitors; sentiment of mentions.

### 4.5 Reporting and alerts (later)
- **FR-22 (L)** Alerts on mention-rate drops or lost citations (email, Slack).
- **FR-23 (L)** Exportable CSV/PDF reports and a shareable read-only client link.

### 4.6 Administration
- **FR-24 (M)** Agency-level view of credit usage by workspace and project.
- **FR-25 (M)** Audit log of key actions (invites, schedule changes, key changes).

## 5. Non-functional requirements

| Area | Requirement |
| - | - |
| **Security** | querying.ai API key stored server-side only (env/secret store); never sent to the browser. Webhook endpoint verifies querying.ai's signature before trusting a body. Per-tenant isolation via Postgres RLS. HTTPS only; secrets never logged. |
| **Privacy / retention** | Answers are kept permanently (decision). Stored answers may contain third-party content. Provide an operator-only manual delete for a workspace on client offboarding or legal request, even though nothing expires automatically. |
| **Storage growth** | Permanent retention means unbounded growth: roughly 5,000 tasks/day at ~10 KB each is about 50 MB/day, or ~18 GB/year before indexes. Keep raw JSON in a separate table (compressed or moved to object storage later) so dashboards query only the slim analysis and rollup tables. Monitor DB size. |
| **Reliability** | No lost results: a scan must settle to completed/partial/failed even if a webhook is missed (reconciliation poller well inside the 24 h retention window). Jobs are idempotent and resumable. |
| **Performance** | Dashboard loads in under 2 s for 12 months of data on a typical project (pre-aggregated rollups). Scan latency is dominated by the engines (minutes); the UI never blocks on it. |
| **Scalability** | Initial target: ~20 clients, ~50 prompts each, 5 engines, 1 market each, daily = about 5,000 tasks/day. Every extra market multiplies volume and cost (e.g. 3 GCC markets = 3x). Must respect querying.ai's plan concurrency limit and the key's daily credit limit by queueing and throttling. |
| **Cost** | Each answer costs 1 to 1.25 credits, so credits are the main variable cost. Budgets and cost estimates are first-class. |
| **Observability** | Structured logs, error tracking, per-scan metrics (success rate, latency, credits), and a failed-task view. |
| **Maintainability** | TypeScript throughout, provider abstraction (swap/mix data providers), migrations in version control, CI running lint, typecheck and tests. |
| **Accessibility / UX** | Responsive, keyboard-accessible, light/dark. |

## 6. External dependency: querying.ai

Facts from the API docs that shape the design:
- Async only: `POST /v1/async/task` returns a task id; the result arrives by webhook or `GET /v1/async/task/{id}`. Finished tasks are retrievable for **24 hours**.
- Auth is a bearer key (`vt_...`) with optional engine scope, daily credit limit and expiry. Max 5 active keys.
- Plan **concurrency limit** counts queued + processing tasks; going over returns `429 PLAN_CONCURRENCY_LIMIT`. Backpressure returns `503` with `Retry-After`. Batch endpoints (500 per request, or 10,000 per batch object) exist for volume.
- Credits are held on submit, charged on completion, released on failure.
- Idempotency keys are supported; supports country selection.
- No Claude engine is offered. Engine availability and country support vary.

Risks: provider outage or pricing change (mitigate with the provider abstraction); engine output variability makes single-run metrics noisy (mitigate by aggregating over time and optionally repeating prompts).

## 7. System components

| # | Component | Responsibility | Tech |
| - | - | - | - |
| 1 | **Web app** | Dashboards, setup UI, admin | Next.js on Vercel |
| 2 | **API layer** | CRUD, scan triggers, auth checks | Next.js route handlers / server actions |
| 3 | **Auth and tenancy** | Users, roles, invites, RLS | Supabase Auth + Postgres RLS |
| 4 | **Database** | Tenants, projects, prompts, runs, answers, sources, rollups | Supabase Postgres |
| 5 | **Scheduler** | Creates scan runs on schedule | Vercel Cron or Supabase `pg_cron` |
| 6 | **Job queue / dispatcher** | Fans out prompt × engine tasks, throttles to concurrency and budget, retries | DB-backed queue worked by cron-driven functions (upgrade to a queue service if needed) |
| 7 | **Provider adapter** | Submit/collect via querying.ai | `src/lib/providers/` (exists) |
| 8 | **Webhook receiver** | Verified ingestion of task results | Route handler |
| 9 | **Reconciler** | Polls tasks with no result; settles runs | Cron-driven function |
| 10 | **Analysis engine** | Mentions, rank, citations, aggregates | `src/lib/analysis.ts` (exists, to extend) |
| 11 | **Rollup jobs** | Pre-aggregate metrics for fast charts | SQL views or scheduled jobs |
| 12 | **Charts / UI kit** | Trends, tables, filters | React + a chart library |
| 13 | **Observability** | Logging, error tracking, alerts to the operator | Vercel logs + e.g. Sentry |
| 14 | **CI/CD** | Lint, typecheck, test, deploy previews | GitHub Actions + Vercel |

## 8. Core data model (draft)

`agency` → `workspace` → `project` (brand, domains, aliases, country, engines, schedule, budget)
`project` → `market` (country code, active) · `prompt` (text, tags, active) · `competitor` (name, domains)
`scan_run` (project, trigger, status, credits_estimated/actual, started/finished)
`task` (scan_run, prompt, engine, market/country, provider_task_id, status, error, credits)
`answer` (task, text, raw JSON) → `source` (answer, url, domain, label, position)
`answer_analysis` (answer, brand_mentioned, rank, domain_cited, competitors_mentioned)
`daily_rollup` (project, engine, market, date, mention_rate, citation_rate, avg_rank, n)
`membership` (user, workspace, role) · `audit_log`

## 9. Constraints and assumptions

- Hosting: Vercel (serverless, so no long-running requests) + Supabase. This is why scans must be queued and collected asynchronously, not run inside a request.
- querying.ai plan limits (concurrency, credits) cap throughput; the dispatcher must be built around them.
- All engines in scope currently accept any country at the API level (querying.ai capabilities show no unsupported countries for them; Perplexity only rejects CN), so GCC and Southeast Asia are usable. Whether answers are meaningfully localised per engine should be validated with a pilot scan.
- Bing AI Mode is limited to a short country list (it includes SG but no GCC country), so it is excluded from the MVP engine set.
- Client billing is out of scope for the MVP; credit cost is tracked, not re-billed.

## 10. Decisions and open questions

### Decisions (confirmed)
1. The **agency pays** for querying.ai credits (single master key; usage tracked per client).
2. Each prompt is run **once per scan**; re-runs are triggered as required.
3. Answers are retained **permanently**.
4. Client viewers are **view-only**.
5. All pages carry **Vimi branding**; no white-label.
6. **English only** for the MVP. Target regions: **GCC** and **Southeast Asia**.

### Open questions
1. Exact launch country list (the GCC and Southeast Asia sets in FR-8 are a proposal).
2. Should prompts be shared across markets, or written per market (e.g. "best bank in Dubai" vs "best bank in Riyadh")? This affects the prompt model.
3. Vimi brand assets (logo, colours, fonts) needed for the theme.
4. Which timezone drives schedules and reporting periods (agency, client or market)?
5. Which later language comes first (Arabic is the likely candidate for GCC)?
