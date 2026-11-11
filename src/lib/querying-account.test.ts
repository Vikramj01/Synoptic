import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getQueryingBalance } from "./querying-account";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

describe("getQueryingBalance", () => {
  it("reads remaining credits and plan with the bearer key", async () => {
    const calls: { url: string; auth: string | null }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
      return json(200, { success: true, remaining: 489.75, perCycle: 500, reserved: 0, plan: "free" });
    }) as unknown as typeof fetch;
    expect(await getQueryingBalance({ provider: "queryingai", apiKey: "vt_k", fetchImpl })).toEqual({ remaining: 489.75, plan: "free" });
    expect(calls).toEqual([{ url: "https://api.querying.ai/v1/credits", auth: "Bearer vt_k" }]);
  });

  it("does nothing (and calls nothing) for the mock provider or without a key", async () => {
    const fetchImpl = vi.fn();
    expect(await getQueryingBalance({ provider: "mock", apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
    expect(await getQueryingBalance({ provider: "queryingai", apiKey: "", fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null on a refusal, a malformed body, an unsuccessful envelope or a network error", async () => {
    const run = (f: () => Promise<Response>) => getQueryingBalance({ provider: "queryingai", apiKey: "k", fetchImpl: f as unknown as typeof fetch });
    expect(await run(async () => json(401, { success: false }))).toBeNull();
    expect(await run(async () => json(200, { success: true }))).toBeNull();
    expect(await run(async () => json(200, { success: true, remaining: "lots" }))).toBeNull();
    expect(await run(async () => json(200, { success: false, remaining: 5 }))).toBeNull();
    expect(await run(async () => new Response("not json", { status: 200 }))).toBeNull();
    expect(await run(async () => { throw new TypeError("fetch failed"); })).toBeNull();
  });

  it("gives up quickly when the request is too slow", async () => {
    const slow = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError"))))) as unknown as typeof fetch;
    const started = Date.now();
    expect(await getQueryingBalance({ provider: "queryingai", apiKey: "k", fetchImpl: slow, timeoutMs: 30 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("tolerates a missing plan and never logs the key", async () => {
    const fetchImpl = (async () => json(200, { success: true, remaining: 3 })) as unknown as typeof fetch;
    expect(await getQueryingBalance({ provider: "queryingai", apiKey: "vt_secret", fetchImpl })).toEqual({ remaining: 3, plan: null });
    const failing = (async () => { throw new Error("boom vt_secret"); }) as unknown as typeof fetch;
    await getQueryingBalance({ provider: "queryingai", apiKey: "vt_secret", fetchImpl: failing });
    const logged = JSON.stringify((console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls);
    expect(logged).not.toContain("vt_secret");
  });
});
