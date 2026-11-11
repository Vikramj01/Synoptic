import { describe, expect, it } from "vitest";
import { createQueryingAiProvider, extractAnswer } from "./queryingai";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("querying.ai adapter", () => {
  it("extracts text and sources, including Google AI Overviews nesting", () => {
    expect(extractAnswer({ text: "hi", sources: [{ position: 1, url: "https://a.com", label: "A" }, { position: 2 }] })).toEqual({
      answer: "hi",
      citations: [{ url: "https://a.com", title: "A" }],
    });
    expect(extractAnswer({ aioverview: { text: "ov", sources: [{ url: "https://b.com" }] } }).answer).toBe("ov");
    expect(extractAnswer({ aioverview: null }).answer).toBe("");
  });

  it("submits then polls until completed", async () => {
    const calls: string[] = [];
    const states = ["QUEUED", "COMPLETED"];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (init?.method === "POST") {
        const sent = JSON.parse(init.body as string);
        expect(sent).toEqual({ taskType: "GEMINI", payload: { prompt: "p", country: "US" } });
        return json(200, { success: true, task: { id: "t1", status: "QUEUED" } });
      }
      const status = states.shift();
      return json(200, { task: { id: "t1", status }, response: status === "COMPLETED" ? { text: "ans", sources: [{ url: "https://x.com/" }] } : undefined });
    }) as unknown as typeof fetch;
    const p = createQueryingAiProvider({ apiKey: "vt_x", fetchImpl, pollIntervalMs: 1 });
    const r = await p.query("p", "gemini");
    expect(r.answer).toBe("ans");
    expect(calls[0]).toBe("POST https://api.querying.ai/v1/async/task");
    expect(calls).toHaveLength(3);
  });

  it("sends the requested market, falling back to the default", async () => {
    const sent: unknown[] = [];
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        sent.push(JSON.parse(init.body as string).payload.country);
        return json(200, { task: { id: "t", status: "QUEUED" } });
      }
      return json(200, { task: { id: "t", status: "COMPLETED" }, response: { text: "a" } });
    }) as unknown as typeof fetch;
    const p = createQueryingAiProvider({ apiKey: "k", fetchImpl, pollIntervalMs: 1 });
    await p.query("p", "chatgpt", "AE");
    await p.query("p", "chatgpt");
    expect(sent).toEqual(["AE", "US"]);
  });

  it("surfaces failed tasks and missing key", async () => {
    const fetchImpl = (async (_u: string, init?: RequestInit) =>
      init?.method === "POST"
        ? json(200, { task: { id: "t", status: "QUEUED" } })
        : json(200, { task: { id: "t", status: "FAILED" }, error: "ENGINE_TIMEOUT: nope" })) as unknown as typeof fetch;
    await expect(createQueryingAiProvider({ apiKey: "k", fetchImpl, pollIntervalMs: 1 }).query("p", "chatgpt")).rejects.toThrow("ENGINE_TIMEOUT");
    await expect(createQueryingAiProvider({ apiKey: "" }).query("p", "chatgpt")).rejects.toThrow("QUERYING_API_KEY");
  });
});

// ---- resilience: the failures seen in a real scan (rate limits, network blips)

type Step = Response | Error;
const err = (status: number, code: string, headers: Record<string, string> = {}, details?: object) =>
  new Response(JSON.stringify({ success: false, error: { code, message: `${code} message`, ...(details ? { details } : {}) } }), { status, headers });
const queued = (id = "t1") => json(200, { task: { id, status: "QUEUED" } });
const done = (text = "ans") => json(200, { task: { id: "t1", status: "COMPLETED" }, response: { text, sources: [] } });

function harness(steps: Step[], extra: Parameters<typeof createQueryingAiProvider>[0] = {}) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const waits: number[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const next = steps.shift();
    if (!next) throw new Error("test ran out of scripted responses");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const provider = createQueryingAiProvider({
    apiKey: "k", fetchImpl, pollIntervalMs: 1, sleep: async (ms) => void waits.push(ms), ...extra,
  });
  return { provider, calls, waits };
}

const netError = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: { code } });

describe("querying.ai adapter: resilience", () => {
  it("waits as long as Retry-After says when the plan concurrency limit is hit, then succeeds", async () => {
    const h = harness([err(429, "PLAN_CONCURRENCY_LIMIT", { "Retry-After": "7" }), err(429, "PLAN_CONCURRENCY_LIMIT", { "Retry-After": "7" }), queued(), done()]);
    expect((await h.provider.query("p", "chatgpt")).answer).toBe("ans");
    // two refusals, each waited ~7s (plus up to 0.5s jitter), nothing like the old fixed 1-2s
    expect(h.waits[0]).toBeGreaterThanOrEqual(7000);
    expect(h.waits[0]).toBeLessThan(7500);
    expect(h.waits[1]).toBeGreaterThanOrEqual(7000);
  });

  it("reads details.retryAfterSec when the header is absent, and caps very long waits", async () => {
    const h = harness([err(503, "QUEUE_BACKPRESSURE", {}, { retryAfterSec: 3 }), err(429, "PLAN_CONCURRENCY_LIMIT", { "Retry-After": "3600" }), queued(), done()]);
    await h.provider.query("p", "chatgpt");
    expect(h.waits[0]).toBeGreaterThanOrEqual(3000);
    expect(h.waits[0]).toBeLessThan(3500);
    expect(h.waits[1]).toBeLessThan(61_000); // never sleeps an hour
  });

  it("falls back to exponential backoff without Retry-After", async () => {
    const h = harness([err(503, "SERVER_OVERLOADED"), err(503, "SERVER_OVERLOADED"), err(503, "SERVER_OVERLOADED"), queued(), done()]);
    await h.provider.query("p", "chatgpt");
    expect(h.waits.slice(0, 3)).toEqual([1000, 2000, 4000]);
  });

  it("gives up with a clear, actionable message when the limit never frees up", async () => {
    const steps = Array.from({ length: 3 }, () => err(429, "PLAN_CONCURRENCY_LIMIT", { "Retry-After": "1" }));
    const h = harness(steps, { maxSubmitAttempts: 3 });
    await expect(h.provider.query("p", "chatgpt")).rejects.toThrow(/gave up after 3 attempts.*PLAN_CONCURRENCY_LIMIT.*QUERYING_CONCURRENCY/);
    expect(h.calls).toHaveLength(3);
  });

  it("does not retry errors that retrying cannot fix", async () => {
    for (const [status, code] of [[429, "KEY_DAILY_CREDIT_LIMIT"], [402, "INSUFFICIENT_CREDITS"], [422, "REGION_UNSUPPORTED"]] as const) {
      const h = harness([err(status, code, { "Retry-After": "40000" })]);
      await expect(h.provider.query("p", "chatgpt")).rejects.toThrow(new RegExp(code));
      expect(h.calls).toHaveLength(1);
      expect(h.waits).toHaveLength(0);
    }
  });

  it("does not retry a plain client error", async () => {
    const h = harness([err(400, "VALIDATION_ERROR")]);
    await expect(h.provider.query("p", "chatgpt")).rejects.toThrow(/submit failed \(400 VALIDATION_ERROR\)/);
    expect(h.calls).toHaveLength(1);
  });

  it("retries a network error on submit, sending the same idempotency key each time", async () => {
    const h = harness([netError("ECONNRESET"), queued(), done()]);
    await h.provider.query("p", "chatgpt", "AE", { idempotencyKey: "run:prompt:chatgpt:AE" });
    const posts = h.calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[0].body).toEqual(posts[1].body);
    expect(posts[0].body).toMatchObject({ idempotencyKey: "run:prompt:chatgpt:AE", payload: { country: "AE" } });
  });

  it("reports the real network cause, not just 'fetch failed'", async () => {
    const h = harness([netError("ETIMEDOUT"), netError("ETIMEDOUT")], { maxSubmitAttempts: 2 });
    await expect(h.provider.query("p", "chatgpt")).rejects.toThrow(/network error: ETIMEDOUT/);
  });

  it("recovers a submit that actually went through (409) by polling the existing task", async () => {
    const h = harness([
      netError("ECONNRESET"),
      err(409, "RESOURCE_ALREADY_EXISTS", {}, { taskId: "existing-7" }),
      json(200, { task: { id: "existing-7", status: "COMPLETED" }, response: { text: "recovered" } }),
    ]);
    expect((await h.provider.query("p", "chatgpt", undefined, { idempotencyKey: "k" })).answer).toBe("recovered");
    expect(h.calls.at(-1)?.url).toMatch(/\/v1\/async\/task\/existing-7$/);
  });

  it("omits idempotencyKey when none is given", async () => {
    const h = harness([queued(), done()]);
    await h.provider.query("p", "chatgpt");
    expect(h.calls[0].body).not.toHaveProperty("idempotencyKey");
  });

  it("survives network errors and 503s while polling instead of failing the query", async () => {
    const h = harness([queued(), netError("ECONNRESET"), err(503, "SERVER_OVERLOADED", { "Retry-After": "2" }), json(200, { task: { id: "t1", status: "PROCESSING" } }), done("late")]);
    expect((await h.provider.query("p", "chatgpt")).answer).toBe("late");
  });

  it("gives up polling after too many consecutive failures, saying the task may still finish", async () => {
    const h = harness([queued(), ...Array.from({ length: 4 }, () => netError("ECONNRESET"))], { maxPollFailures: 3 });
    await expect(h.provider.query("p", "chatgpt")).rejects.toThrow(/poll gave up after 4 consecutive failures.*may still complete/);
  });

  it("resets the failure count after a successful poll", async () => {
    const h = harness([queued(), netError("X"), netError("X"), json(200, { task: { id: "t1", status: "PROCESSING" } }), netError("X"), netError("X"), done()], { maxPollFailures: 2 });
    expect((await h.provider.query("p", "chatgpt")).answer).toBe("ans");
  });
});
