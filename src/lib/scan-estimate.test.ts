import { describe, expect, it } from "vitest";
import { buildJobs, checkBudget } from "./scan-plan";
import {
  estimateFromForm, estimateFromJobs, evaluateScan, formatCredits, formatDuration, readFormInputs, scanPricing,
  SECONDS_PER_QUERY,
} from "./scan-estimate";

const paid = scanPricing({ PROVIDER: "queryingai" }); // free plan: 2 at a time
const free = scanPricing({ PROVIDER: "mock" });

describe("scanPricing", () => {
  it("prices each engine as querying.ai does, with the Free-plan concurrency by default", () => {
    expect(paid.prices.chatgpt).toBe(1);
    expect(paid.prices.gemini).toBe(1.25);
    expect(paid.concurrency).toBe(2);
  });
  it("is free and wider for the mock provider, and honours QUERYING_CONCURRENCY", () => {
    expect(Object.values(free.prices).every((p) => p === 0)).toBe(true);
    expect(free.concurrency).toBe(5);
    expect(scanPricing({ PROVIDER: "queryingai", QUERYING_CONCURRENCY: "50" }).concurrency).toBe(50);
  });
});

describe("estimateFromJobs", () => {
  it("matches the scan you actually saw: 10 ChatGPT queries = 10 credits, ~2 min at 2 at a time", () => {
    const jobs = buildJobs({
      engines: ["chatgpt"],
      prompts: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, text: "t", countries: ["US"] })),
    });
    const e = estimateFromJobs(paid, jobs);
    expect(e).toMatchObject({ queries: 10, credits: 10, free: false });
    expect(e.byEngine).toEqual([{ engine: "chatgpt", queries: 10, credits: 10 }]);
    expect(e.seconds).toBe(5 * SECONDS_PER_QUERY); // ceil(10 / 2) rounds of ~25 s
  });

  it("breaks a mixed scan down by engine, biggest total first", () => {
    const e = estimateFromJobs(paid, [
      { engine: "chatgpt" }, { engine: "chatgpt" }, { engine: "gemini" }, { engine: "perplexity" },
    ]);
    expect(e.credits).toBe(4.25);
    // ordered by each engine's total credits: chatgpt 2 > gemini 1.25 > perplexity 1
    expect(e.byEngine).toEqual([
      { engine: "chatgpt", queries: 2, credits: 2 },
      { engine: "gemini", queries: 1, credits: 1.25 },
      { engine: "perplexity", queries: 1, credits: 1 },
    ]);
  });

  it("is zero for an empty scan and free for the mock provider", () => {
    expect(estimateFromJobs(paid, [])).toMatchObject({ queries: 0, credits: 0, seconds: 0, byEngine: [] });
    expect(estimateFromJobs(free, [{ engine: "chatgpt" }])).toMatchObject({ queries: 1, credits: 0, free: true });
  });

  it("agrees with the server's own estimate for the same jobs", async () => {
    const { estimateCredits } = await import("./scan-plan");
    const jobs = (["chatgpt", "gemini", "gemini", "perplexity", "google_ai_mode"] as const).map((engine) => ({ engine }));
    expect(estimateFromJobs(paid, [...jobs]).credits).toBe(estimateCredits("queryingai", [...jobs]));
  });
});

describe("estimateFromForm", () => {
  it("multiplies prompts x markets for every selected engine", () => {
    const e = estimateFromForm(paid, { prompts: 10, engines: ["chatgpt", "gemini", "perplexity"], markets: 1 });
    expect(e.queries).toBe(30);
    expect(e.credits).toBe(10 + 12.5 + 10);
    const multi = estimateFromForm(paid, { prompts: 10, engines: ["chatgpt"], markets: 3 });
    expect(multi).toMatchObject({ queries: 30, credits: 30 });
  });

  it("ignores unknown engines and negative or empty inputs", () => {
    expect(estimateFromForm(paid, { prompts: 5, engines: ["not-an-engine"], markets: 1 }).queries).toBe(0);
    expect(estimateFromForm(paid, { prompts: -3, engines: ["chatgpt"], markets: 1 }).queries).toBe(0);
    expect(estimateFromForm(paid, { prompts: 5, engines: [], markets: 2 }).queries).toBe(0);
    expect(estimateFromForm(paid, { prompts: 5, engines: ["chatgpt"], markets: 0 }).queries).toBe(0);
  });

  it("matches estimateFromJobs for the same shape", () => {
    const jobs = buildJobs({
      engines: ["chatgpt", "gemini"],
      prompts: [{ id: "a", text: "a", countries: ["US", "AE"] }, { id: "b", text: "b", countries: ["US", "AE"] }],
    });
    expect(estimateFromForm(paid, { prompts: 2, engines: ["chatgpt", "gemini"], markets: 2 })).toEqual(estimateFromJobs(paid, jobs));
  });
});

describe("readFormInputs", () => {
  it("reads prompts (unique non-empty lines), engines, markets and budget", () => {
    const fd = new FormData();
    fd.set("prompts", "one\n\n two \none\nthree");
    fd.append("engines", "chatgpt");
    fd.append("engines", "gemini");
    fd.append("countries", "US");
    fd.set("budget", " 20 ");
    expect(readFormInputs(fd)).toEqual({ prompts: 3, engines: ["chatgpt", "gemini"], markets: 1, budget: 20 });
  });
  it("treats a blank, negative or junk budget as no budget", () => {
    for (const b of ["", "  ", "-5", "abc", "NaN"]) {
      const fd = new FormData();
      fd.set("budget", b);
      expect(readFormInputs(fd).budget).toBeNull();
    }
  });
  it("copes with an empty form", () => {
    expect(readFormInputs(new FormData())).toEqual({ prompts: 0, engines: [], markets: 0, budget: null });
  });
});

describe("formatting", () => {
  it("formats durations", () => {
    expect(formatDuration(0)).toBe("no time");
    expect(formatDuration(25)).toBe("under a minute");
    expect(formatDuration(125)).toBe("about 3 min");
    expect(formatDuration(60 * 119)).toBe("about 119 min");
    expect(formatDuration(60 * 150)).toBe("about 2.5 hours");
  });
  it("formats credits without trailing zeros", () => {
    expect(formatCredits(10)).toBe("10");
    expect(formatCredits(1.25)).toBe("1.25");
    expect(formatCredits(12.5)).toBe("12.5");
    expect(formatCredits(0)).toBe("0");
  });
});

describe("evaluateScan", () => {
  const est = (queries: number, credits: number, seconds = 60) => ({ queries, credits, byEngine: [], seconds, free: credits === 0 });

  it("allows a scan that fits every budget and the balance", () => {
    const r = evaluateScan({
      estimate: est(10, 10),
      budgets: [checkBudget("Project", 20, 0, 10), checkBudget("Workspace", null, 0, 10)],
      balance: 100,
    });
    expect(r).toEqual({ blockers: [], warnings: [] });
  });

  it("blocks with the same message the server would give when a budget is exceeded", () => {
    const r = evaluateScan({ estimate: est(10, 12.5), budgets: [checkBudget("Project", 5, 0, 12.5)], balance: null });
    expect(r.blockers).toEqual(["Project monthly credit budget would be exceeded: 0 used + 12.5 estimated > 5 budget."]);
  });

  it("reports every exceeded budget", () => {
    const r = evaluateScan({
      estimate: est(10, 10),
      budgets: [checkBudget("Project", 5, 0, 10), checkBudget("Workspace", 8, 0, 10)],
      balance: null,
    });
    expect(r.blockers).toHaveLength(2);
  });

  it("blocks when the account balance is too low, but not when it is unknown", () => {
    expect(evaluateScan({ estimate: est(10, 10), budgets: [], balance: 8.5 }).blockers).toEqual([
      "Not enough querying.ai credits: this scan needs 10 but your balance is 8.5.",
    ]);
    expect(evaluateScan({ estimate: est(10, 10), budgets: [], balance: null }).blockers).toEqual([]);
    expect(evaluateScan({ estimate: est(10, 10), budgets: [], balance: 10 }).blockers).toEqual([]); // exactly enough
  });

  it("blocks an empty scan", () => {
    expect(evaluateScan({ estimate: est(0, 0, 0), budgets: [], balance: 50 }).blockers[0]).toMatch(/Nothing to scan/);
  });

  it("warns, without blocking, about scans that take a long time", () => {
    const r = evaluateScan({ estimate: est(100, 100, 1300), budgets: [], balance: 500 });
    expect(r.blockers).toEqual([]);
    expect(r.warnings[0]).toMatch(/may take about 22 min/);
    expect(evaluateScan({ estimate: est(10, 10, 300), budgets: [], balance: 500 }).warnings).toEqual([]);
  });
});
