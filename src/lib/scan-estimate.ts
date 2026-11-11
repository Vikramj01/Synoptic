import { uniqueLines } from "./lines";
import { checkBudget, budgetMessage, creditsForTask, scanConcurrency, type BudgetStatus } from "./scan-plan";
import { ENGINES, type Engine } from "./types";

/**
 * Credit and time estimate for a scan, before it runs. Pure, so the server
 * panel and the client-side form compute exactly the same numbers.
 */

export type PriceTable = Record<Engine, number>;

export interface ScanPricing {
  /** Credits per query, by engine. All zero for the free mock provider. */
  prices: PriceTable;
  /** Queries run at once. */
  concurrency: number;
}

export interface EngineEstimate {
  engine: Engine;
  queries: number;
  credits: number;
}

export interface ScanEstimate {
  queries: number;
  credits: number;
  byEngine: EngineEstimate[];
  /** Rough wall-clock time. */
  seconds: number;
  /** True when no credits are charged (mock provider). */
  free: boolean;
}

/** Observed: about 22 s per ChatGPT answer on querying.ai; allow a little headroom. */
export const SECONDS_PER_QUERY = 25;

const round = (n: number) => Math.round(n * 100) / 100;

export function scanPricing(env: Record<string, string | undefined> = process.env): ScanPricing {
  return {
    prices: Object.fromEntries(ENGINES.map((e) => [e, creditsForTask(env.PROVIDER, e)])) as PriceTable,
    concurrency: scanConcurrency(env.PROVIDER, env.QUERYING_CONCURRENCY),
  };
}

export function estimateFromEngineCounts(pricing: ScanPricing, queriesByEngine: Partial<Record<Engine, number>>): ScanEstimate {
  const byEngine: EngineEstimate[] = ENGINES.flatMap((engine) => {
    const queries = queriesByEngine[engine] ?? 0;
    return queries > 0 ? [{ engine, queries, credits: round(queries * pricing.prices[engine]) }] : [];
  }).sort((a, b) => b.credits - a.credits || b.queries - a.queries || a.engine.localeCompare(b.engine));

  const queries = byEngine.reduce((n, e) => n + e.queries, 0);
  return {
    queries,
    credits: round(byEngine.reduce((n, e) => n + e.credits, 0)),
    byEngine,
    seconds: queries === 0 ? 0 : Math.ceil(queries / Math.max(1, pricing.concurrency)) * SECONDS_PER_QUERY,
    free: byEngine.every((e) => pricing.prices[e.engine] === 0),
  };
}

/** From the actual job list of a saved project. */
export function estimateFromJobs(pricing: ScanPricing, jobs: { engine: Engine }[]): ScanEstimate {
  const counts: Partial<Record<Engine, number>> = {};
  for (const j of jobs) counts[j.engine] = (counts[j.engine] ?? 0) + 1;
  return estimateFromEngineCounts(pricing, counts);
}

/** From form inputs: every prompt runs on every engine in every market. */
export function estimateFromForm(pricing: ScanPricing, input: { prompts: number; engines: string[]; markets: number }): ScanEstimate {
  const perEngine = Math.max(0, input.prompts) * Math.max(0, input.markets);
  const counts: Partial<Record<Engine, number>> = {};
  for (const e of input.engines) if ((ENGINES as string[]).includes(e)) counts[e as Engine] = perEngine;
  return estimateFromEngineCounts(pricing, counts);
}

/** What the project form currently says, read from its fields. */
export function readFormInputs(fd: FormData): { prompts: number; engines: string[]; markets: number; budget: number | null } {
  const budget = String(fd.get("budget") ?? "").trim();
  const n = Number(budget);
  return {
    prompts: uniqueLines(String(fd.get("prompts") ?? "")).length,
    engines: fd.getAll("engines").map(String),
    markets: fd.getAll("countries").length,
    budget: budget && Number.isFinite(n) && n >= 0 ? n : null,
  };
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "no time";
  if (seconds < 45) return "under a minute";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 120) return `about ${minutes} min`;
  return `about ${(minutes / 60).toFixed(1)} hours`;
}

export function formatCredits(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}

export interface ScanEvaluation {
  /** Reasons the scan cannot run (it would be refused or fail). */
  blockers: string[];
  /** Things worth knowing that do not stop the scan. */
  warnings: string[];
}

/** Long scans run inside the request today, so flag ones that may be slow to wait for. */
export const LONG_SCAN_SECONDS = 300;

export function evaluateScan(input: {
  estimate: ScanEstimate;
  budgets: (BudgetStatus | null)[];
  /** querying.ai credits available now; null when unknown. */
  balance: number | null;
}): ScanEvaluation {
  const { estimate, budgets, balance } = input;
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (estimate.queries === 0) {
    blockers.push("Nothing to scan: the project needs at least one prompt, engine and market.");
  }
  for (const b of budgets) if (b?.exceeded) blockers.push(budgetMessage(b));
  if (balance !== null && estimate.credits > balance) {
    blockers.push(`Not enough querying.ai credits: this scan needs ${formatCredits(estimate.credits)} but your balance is ${formatCredits(balance)}.`);
  }
  if (estimate.seconds > LONG_SCAN_SECONDS) {
    warnings.push(
      `This scan runs while you wait on the page and may take ${formatDuration(estimate.seconds)}. Splitting it into smaller scans is safer.`,
    );
  }
  return { blockers, warnings };
}

export { checkBudget };
