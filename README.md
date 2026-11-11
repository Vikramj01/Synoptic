# Synoptic

AI visibility (GEO) monitoring. Give it a domain, a brand, competitors and a set of prompts; it asks multiple AI engines and reports whether your brand is mentioned, where it ranks against competitors, and whether your domain is cited.

**Stack:** Next.js (App Router) · TypeScript · Tailwind · Vitest

## Getting started

```bash
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:3000. By default a deterministic mock provider is used so the app works with no querying.ai key (it needs Supabase; see the setup sections below).

## Authentication

Sign-in is by Supabase magic link (email). Accounts are created by invitation only; the login form never creates one. Everything except `/login` and `/auth/*` requires a session: `src/proxy.ts` redirects signed-out visitors, and `src/lib/auth.ts` (`getCurrentUser`) is the authoritative per-request check used by pages and API routes.

Setup:

1. Copy `.env.example` to `.env` and fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
2. In Supabase, Authentication > URL Configuration: add `http://localhost:3000/auth/callback` (and your deployed URL's `/auth/callback`) to **Redirect URLs**.
3. Add `SUPABASE_SERVICE_ROLE_KEY` to `.env` (server only, never `NEXT_PUBLIC_`). The app uses it solely to write scan results, after checking the user can run scans in that workspace.
4. Run `npm run bootstrap` once (above) to create the first operator, then sign in at `/login`.

## Providers

`src/lib/providers/` holds engine providers behind one `EngineProvider` interface.

- `mock` (default): fake answers for development.
- `queryingai`: adapter for the [querying.ai async task API](https://docs.querying.ai). Set `PROVIDER=queryingai` and `QUERYING_API_KEY` (from https://querying.ai/dashboard/keys) in `.env`. Engines: ChatGPT, Gemini, Perplexity, Copilot, Google AI Overviews, Google AI Mode, Meta AI. Each prompt x engine costs 1-1.25 credits.

## Layout

- `supabase/migrations/`: schema, RLS and SQL functions (tenancy, projects, scans, audit log)
- `src/lib/analysis.ts`: mention, rank and citation detection against a project's brand, aliases, domains and competitors (tested)
- `src/lib/scan-plan.ts`: job expansion, budget checks, status and concurrency helpers (tested)
- `src/lib/scans.ts`: runs a project's scan and stores it in `scan_runs`, `tasks`, `answers`, `sources`, `answer_analysis`, `credit_ledger` and `daily_rollups`; reads runs back
- `src/lib/projects.ts`: workspaces, projects and their configuration (runs as the signed-in user, RLS applies)
- `src/app/`: `/` project list, `/projects/new`, `/projects/[id]` (config, run scan, history, results), `/login`, `/auth/*`

Scans currently run inside the request, `QUERYING_CONCURRENCY` queries at a time (default 2, matching querying.ai's Free plan; raise it to your plan's concurrent-task limit). Large scans against a live provider will need the async dispatcher.

## First-time setup (Supabase)

Migrations live in `supabase/migrations/`. Once they are applied to your project, create the first agency and operator (RLS blocks this through the API by design):

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role key> \
npm run bootstrap -- --agency "Your Agency" --email you@example.com --confirm-project-ref <ref>
```

It is idempotent. `--confirm-project-ref` must match the ref in `SUPABASE_URL`, so it cannot hit the wrong project. The operator signs in with a magic link. Never commit the service-role key.

## Scripts

`npm run dev` · `npm run build` · `npm test` · `npm run lint` · `npm run bootstrap`
