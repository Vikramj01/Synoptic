import type { Engine } from "./types";

/** Pure planning logic for scans (no I/O), so it can be unit-tested. */

export interface PlanInput {
  engines: Engine[];
  prompts: { id: string; text: string; countries: string[] }[];
}

export interface ScanJob {
  promptId: string;
  promptText: string;
  engine: Engine;
  country: string;
}

/** One job per prompt x engine x market the prompt is active in (FR-10, FR-11). */
export function buildJobs(config: PlanInput): ScanJob[] {
  return config.prompts.flatMap((p) =>
    config.engines.flatMap((engine) =>
      p.countries.map((country) => ({ promptId: p.id, promptText: p.text, engine, country })),
    ),
  );
}

/** Stable per-task key, sent to providers that support idempotent submits (FR-13). */
export function idempotencyKey(runId: string, job: ScanJob): string {
  return `${runId}:${job.promptId}:${job.engine}:${job.country}`;
}

/** querying.ai credits per answer, by engine (https://api.querying.ai/v1/capabilities). */
export const QUERYING_AI_CREDITS: Record<Engine, number> = {
  chatgpt: 1,
  perplexity: 1,
  copilot: 1,
  meta_ai: 1,
  gemini: 1.25,
  google_ai_overviews: 1.25,
  google_ai_mode: 1.25,
};

/** Credits one query costs. Only querying.ai charges; the mock provider is free. */
export function creditsForTask(provider: string | undefined, engine: Engine): number {
  return provider === "queryingai" ? QUERYING_AI_CREDITS[engine] : 0;
}

/** Total estimated credits for a set of jobs, to two decimals. */
export function estimateCredits(provider: string | undefined, jobs: { engine: Engine }[]): number {
  return Math.round(jobs.reduce((sum, j) => sum + creditsForTask(provider, j.engine), 0) * 100) / 100;
}

export class BudgetExceededError extends Error {}

const round = (n: number) => Math.round(n * 100) / 100;

export interface BudgetStatus {
  label: string;
  budget: number;
  /** Credits already committed this month (charged + held - released). */
  committed: number;
  /** What this scan would add. */
  estimate: number;
  /** Committed after the scan. */
  after: number;
  /** Budget left before the scan (can be negative). */
  remaining: number;
  exceeded: boolean;
}

/** Where a scan would leave a monthly budget; null when there is no budget. */
export function checkBudget(label: string, budget: number | null, committed: number, estimate: number): BudgetStatus | null {
  if (budget === null) return null;
  return {
    label, budget, committed, estimate,
    after: round(committed + estimate),
    remaining: round(budget - committed),
    exceeded: committed + estimate > budget,
  };
}

export function budgetMessage(s: BudgetStatus): string {
  return `${s.label} monthly credit budget would be exceeded: ${round(s.committed)} used + ${round(s.estimate)} estimated > ${round(s.budget)} budget.`;
}

/** Hard stop (FR-14): refuse a scan that would push this month's committed credits past the budget. */
export function assertWithinBudget(
  label: string,
  budget: number | null,
  committed: number,
  estimate: number,
): void {
  const status = checkBudget(label, budget, committed, estimate);
  if (status?.exceeded) throw new BudgetExceededError(budgetMessage(status));
}

export type ScanStatus = "completed" | "partial" | "failed";

export function finalStatus(succeeded: number, failed: number): ScanStatus {
  if (failed === 0) return "completed";
  return succeeded === 0 ? "failed" : "partial";
}

/** First instant of the current UTC month, as ISO text. */
export function monthStartUtc(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * How many provider queries to run at once. querying.ai limits queued + running
 * tasks per plan (Free 2, Basic 50, Pro 200, ...), and a submit over the limit
 * is refused. Default to the Free-plan limit; raise QUERYING_CONCURRENCY to
 * match your plan. The mock provider has no limit.
 */
export function scanConcurrency(provider: string | undefined, configured: string | undefined): number {
  const n = Number(configured);
  if (configured && Number.isInteger(n) && n >= 1) return Math.min(n, 50);
  return provider === "queryingai" ? 2 : 5;
}
