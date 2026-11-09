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

export interface QueryingAiOptions {
  apiKey?: string;
  baseUrl?: string;
  country?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createQueryingAiProvider(opts: QueryingAiOptions = {}): EngineProvider {
  const apiKey = opts.apiKey ?? process.env.QUERYING_API_KEY;
  const baseUrl = (opts.baseUrl ?? process.env.QUERYING_BASE_URL ?? "https://api.querying.ai").replace(/\/$/, "");
  const country = opts.country ?? process.env.QUERYING_COUNTRY ?? "US";
  const pollMs = opts.pollIntervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const doFetch = opts.fetchImpl ?? fetch;

  async function call(path: string, init?: RequestInit): Promise<{ status: number; body: TaskResult & { error?: unknown } }> {
    const res = await doFetch(`${baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  return {
    async query(prompt, engine) {
      if (!apiKey) throw new Error("QUERYING_API_KEY is not set");

      // Submit, retrying on 429/503 which carry transient backpressure.
      let id: string | undefined;
      for (let attempt = 0; attempt < 4 && !id; attempt++) {
        const { status, body } = await call("/v1/async/task", {
          method: "POST",
          body: JSON.stringify({ taskType: TASK_TYPES[engine], payload: { prompt, country } }),
        });
        if (status === 429 || status === 503) {
          await sleep(Math.min(2 ** attempt * 1000, 10_000));
          continue;
        }
        if (status >= 400 || !body.task?.id) throw new Error(`submit failed (${status}): ${errText(body.error)}`);
        id = body.task.id;
      }
      if (!id) throw new Error("submit failed: service busy, try again later");

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const { status, body } = await call(`/v1/async/task/${id}`);
        if (status >= 400 && status !== 429 && status !== 503) throw new Error(`poll failed (${status}): ${errText(body.error)}`);
        const st = body.task?.status;
        if (st === "COMPLETED") return extractAnswer(body.response);
        if (st === "FAILED") throw new Error(errText(body.error));
        await sleep(pollMs);
      }
      throw new Error(`timed out waiting for task ${id}`);
    },
  };
}
