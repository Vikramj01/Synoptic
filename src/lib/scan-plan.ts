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

/** querying.ai charges 1 to 1.25 credits per answer; estimate with the worst case. */
export const QUERYING_AI_MAX_CREDITS_PER_TASK = 1.25;

export function creditsPerTask(provider: string | undefined): number {
  return provider === "queryingai" ? QUERYING_AI_MAX_CREDITS_PER_TASK : 0;
}

export class BudgetExceededError extends Error {}

/** Hard stop (FR-14): refuse a scan that would push this month's committed credits past the budget. */
export function assertWithinBudget(
  label: string,
  budget: number | null,
  committed: number,
  estimate: number,
): void {
  if (budget === null) return;
  if (committed + estimate > budget) {
    throw new BudgetExceededError(
      `${label} monthly credit budget would be exceeded: ${round(committed)} used + ${round(estimate)} estimated > ${round(budget)} budget.`,
    );
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

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
