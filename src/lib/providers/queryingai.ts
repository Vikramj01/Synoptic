import type { Citation, Engine, EngineAnswer } from "../types";
import type { EngineProvider } from "./types";

/**
 * Adapter for the querying.ai async task API (https://docs.querying.ai).
 * Submit POST /v1/async/task, then poll GET /v1/async/task/{id} until terminal.
 * Config: QUERYING_API_KEY (required, "vt_..."), QUERYING_BASE_URL (optional).
 */

export const TASK_TYPES: Record<Engine, string> = {
  chatgpt: "CHATGPT",
  gemini: "GEMINI",
  perplexity: "PERPLEXITY",
  copilot: "COPILOT",
  google_ai_overviews: "GOOGLE",
  google_ai_mode: "AIMODE",
  meta_ai: "META_AI",
};

interface Source {
  url?: string;
  label?: string;
}

interface TaskResult {
  success?: boolean;
  task?: { id: string; status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response?: any;
  error?: string | { code?: string; message?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: TaskResult["error"]) => (typeof e === "string" ? e : (e?.message ?? e?.code ?? "unknown error"));

/** Pull answer text and sources out of an engine response (Google AI Overviews nests under `aioverview`). */
export function extractAnswer(response: TaskResult["response"]): EngineAnswer {
  const body = response?.aioverview ?? response ?? {};
  const sources: Source[] = Array.isArray(body.sources) ? body.sources : [];
  const citations: Citation[] = sources
    .filter((s): s is Source & { url: string } => typeof s?.url === "string")
    .map((s) => ({ url: s.url, title: s.label || undefined }));
  return { answer: typeof body.text === "string" ? body.text : "", citations };
}

export const DEFAULT_BASE_URL = "https://api.querying.ai";

/** The API base URL: explicit override, then QUERYING_BASE_URL, then the public default. */
export function queryingBaseUrl(override?: string): string {
  return (override ?? process.env.QUERYING_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
}

export interface QueryingAiOptions {
  apiKey?: string;
  baseUrl?: string;
  country?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  /** Submit attempts before giving up on 429/503/network errors. */
  maxSubmitAttempts?: number;
  /** Consecutive failed polls tolerated before giving up on a task. */
  maxPollFailures?: number;
  fetchImpl?: typeof fetch;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** Errors that retrying cannot fix: stop immediately and say why. */
const FAIL_FAST = new Set(["KEY_DAILY_CREDIT_LIMIT", "SUB_ACCOUNT_CREDIT_LIMIT", "INSUFFICIENT_CREDITS", "REGION_UNSUPPORTED"]);

const MAX_WAIT_MS = 60_000;

interface CallResult {
  /** 0 means the request never got a response (network error). */
  status: number;
  body: TaskResult & { error?: unknown };
  retryAfterMs: number | null;
  networkError?: string;
}

const errCode = (body: CallResult["body"]): string | undefined => {
  const e = body.error as { code?: string } | string | undefined;
  return typeof e === "object" && e !== null ? e.code : undefined;
};

const isTransient = (status: number) => status === 0 || status === 429 || status >= 500;

/** Wait the server's Retry-After when given, otherwise back off exponentially. */
const waitMs = (attempt: number, retryAfterMs: number | null) =>
  retryAfterMs !== null ? Math.min(retryAfterMs, MAX_WAIT_MS) + Math.floor(Math.random() * 500) : Math.min(1000 * 2 ** attempt, 30_000);

export function createQueryingAiProvider(opts: QueryingAiOptions = {}): EngineProvider {
  const apiKey = opts.apiKey ?? process.env.QUERYING_API_KEY;
  const baseUrl = queryingBaseUrl(opts.baseUrl);
  const country = opts.country ?? process.env.QUERYING_COUNTRY ?? "US";
  const pollMs = opts.pollIntervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const maxSubmitAttempts = opts.maxSubmitAttempts ?? 8;
  const maxPollFailures = opts.maxPollFailures ?? 5;
  const doFetch = opts.fetchImpl ?? fetch;
  const wait = opts.sleep ?? sleep;

  async function call(path: string, init?: RequestInit): Promise<CallResult> {
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      });
    } catch (e) {
      // Node's fetch says only "fetch failed"; the real reason (timeout, reset, DNS) is on `cause`.
      const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
      const reason = cause?.code ?? cause?.message ?? (e instanceof Error ? e.message : String(e));
      return { status: 0, body: {}, retryAfterMs: null, networkError: reason };
    }
    const body = await res.json().catch(() => ({}));
    const header = Number(res.headers?.get?.("retry-after"));
    const detail = Number((body as { error?: { details?: { retryAfterSec?: number } } })?.error?.details?.retryAfterSec);
    const sec = Number.isFinite(header) && header > 0 ? header : Number.isFinite(detail) && detail > 0 ? detail : null;
    return { status: res.status, body, retryAfterMs: sec === null ? null : sec * 1000 };
  }

  return {
    async query(prompt, engine, countryOverride, queryOpts) {
      if (!apiKey) throw new Error("QUERYING_API_KEY is not set");

      const submitBody = JSON.stringify({
        taskType: TASK_TYPES[engine],
        ...(queryOpts?.idempotencyKey ? { idempotencyKey: queryOpts.idempotencyKey } : {}),
        payload: { prompt, country: countryOverride ?? country },
      });

      // Submit, retrying only what is transient. The idempotency key makes a retry safe:
      // if an earlier attempt actually went through, the API answers 409 with its task id.
      let id: string | undefined;
      let last = "";
      let lastCode: string | undefined;
      for (let attempt = 0; attempt < maxSubmitAttempts && !id; attempt++) {
        const r = await call("/v1/async/task", { method: "POST", body: submitBody });
        const code = errCode(r.body);
        if (r.status >= 200 && r.status < 300 && r.body.task?.id) {
          id = r.body.task.id;
          break;
        }
        const existing = (r.body.error as { details?: { taskId?: string } } | undefined)?.details?.taskId;
        if (r.status === 409 && code === "RESOURCE_ALREADY_EXISTS" && existing) {
          id = existing;
          break;
        }
        if (code && FAIL_FAST.has(code)) throw new Error(`submit refused (${r.status} ${code}): ${errText(r.body.error)}`);
        if (!isTransient(r.status)) {
          throw new Error(`submit failed (${r.status}${code ? ` ${code}` : ""}): ${errText(r.body.error)}`);
        }
        last = r.status === 0 ? `network error: ${r.networkError}` : `HTTP ${r.status}${code ? ` ${code}` : ""}`;
        lastCode = code;
        if (attempt < maxSubmitAttempts - 1) await wait(waitMs(attempt, r.retryAfterMs));
      }
      if (!id) {
        const hint =
          lastCode === "PLAN_CONCURRENCY_LIMIT"
            ? " Your plan's concurrent-task limit was reached: lower QUERYING_CONCURRENCY or upgrade the plan."
            : "";
        throw new Error(`submit gave up after ${maxSubmitAttempts} attempts (last: ${last}).${hint}`);
      }

      // Poll. A hiccup here must not fail the query: the task keeps running (and is charged) at querying.ai.
      const deadline = Date.now() + timeoutMs;
      let failures = 0;
      while (Date.now() < deadline) {
        const r = await call(`/v1/async/task/${id}`);
        if (isTransient(r.status)) {
          failures++;
          if (failures > maxPollFailures) {
            const why = r.status === 0 ? `network error: ${r.networkError}` : `HTTP ${r.status}`;
            throw new Error(`poll gave up after ${failures} consecutive failures (last: ${why}); task ${id} may still complete at querying.ai`);
          }
          await wait(waitMs(failures - 1, r.retryAfterMs));
          continue;
        }
        failures = 0;
        if (r.status >= 400) throw new Error(`poll failed (${r.status}): ${errText(r.body.error)}`);
        const st = r.body.task?.status;
        if (st === "COMPLETED") return extractAnswer(r.body.response);
        if (st === "FAILED") throw new Error(errText(r.body.error));
        await wait(pollMs);
      }
      throw new Error(`timed out waiting for task ${id}`);
    },
  };
}
