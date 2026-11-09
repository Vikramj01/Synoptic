# Synoptic

AI visibility (GEO) monitoring. Give it a domain, a brand, competitors and a set of prompts; it asks multiple AI engines and reports whether your brand is mentioned, where it ranks against competitors, and whether your domain is cited.

**Stack:** Next.js (App Router) · TypeScript · Tailwind · Vitest

## Getting started

```bash
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:3000. By default a deterministic mock provider is used so the app works with no API key.

## Providers

`src/lib/providers/` holds engine providers behind one `EngineProvider` interface.

- `mock` (default): fake answers for development.
- `queryingai`: adapter for the [querying.ai async task API](https://docs.querying.ai). Set `PROVIDER=queryingai` and `QUERYING_API_KEY` (from https://querying.ai/dashboard/keys) in `.env`. Engines: ChatGPT, Gemini, Perplexity, Copilot, Google AI Overviews, Google AI Mode, Meta AI. Each prompt x engine costs 1-1.25 credits.

## Layout

- `src/lib/analysis.ts`: mention, rank and citation detection (tested)
- `src/lib/scan.ts`: runs prompts x engines and summarizes
- `src/lib/store.ts`: JSON-file persistence (dev only; swap for a database to deploy)
- `src/app/api/scans`: `GET` history, `POST` run a scan
- `src/app/page.tsx`: dashboard

## Scripts

`npm run dev` · `npm run build` · `npm test` · `npm run lint`
