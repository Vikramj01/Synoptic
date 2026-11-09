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

  it("surfaces failed tasks and missing key", async () => {
    const fetchImpl = (async (_u: string, init?: RequestInit) =>
      init?.method === "POST"
        ? json(200, { task: { id: "t", status: "QUEUED" } })
        : json(200, { task: { id: "t", status: "FAILED" }, error: "ENGINE_TIMEOUT: nope" })) as unknown as typeof fetch;
    await expect(createQueryingAiProvider({ apiKey: "k", fetchImpl, pollIntervalMs: 1 }).query("p", "chatgpt")).rejects.toThrow("ENGINE_TIMEOUT");
    await expect(createQueryingAiProvider({ apiKey: "" }).query("p", "chatgpt")).rejects.toThrow("QUERYING_API_KEY");
  });
});
