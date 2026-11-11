import { describe, expect, it } from "vitest";
import {
  assertWithinBudget, BudgetExceededError, budgetMessage, buildJobs, checkBudget, creditsForTask, estimateCredits, finalStatus,
  idempotencyKey, mapPool, monthStartUtc, scanConcurrency,
} from "./scan-plan";

describe("buildJobs", () => {
  it("expands prompts x engines x the markets each prompt is active in", () => {
    const jobs = buildJobs({
      engines: ["chatgpt", "gemini"],
      prompts: [
        { id: "p1", text: "a", countries: ["AE", "SA"] },
        { id: "p2", text: "b", countries: ["AE"] },
        { id: "p3", text: "c", countries: [] },
      ],
    });
    expect(jobs).toHaveLength(2 * 2 + 2 * 1);
    expect(jobs.filter((j) => j.promptId === "p3")).toHaveLength(0);
    expect(jobs[0]).toEqual({ promptId: "p1", promptText: "a", engine: "chatgpt", country: "AE" });
  });

  it("is empty with no engines or no prompts", () => {
    expect(buildJobs({ engines: [], prompts: [{ id: "p", text: "a", countries: ["AE"] }] })).toEqual([]);
    expect(buildJobs({ engines: ["chatgpt"], prompts: [] })).toEqual([]);
  });

  it("gives every task a distinct idempotency key", () => {
    const jobs = buildJobs({
      engines: ["chatgpt", "gemini"],
      prompts: [{ id: "p1", text: "a", countries: ["AE", "SA"] }],
    });
    expect(new Set(jobs.map((j) => idempotencyKey("run", j))).size).toBe(jobs.length);
  });
});

describe("credits and budgets", () => {
  it("prices each engine as querying.ai does, and only querying.ai costs credits", () => {
    expect(creditsForTask("queryingai", "chatgpt")).toBe(1);
    expect(creditsForTask("queryingai", "perplexity")).toBe(1);
    expect(creditsForTask("queryingai", "gemini")).toBe(1.25);
    expect(creditsForTask("queryingai", "google_ai_mode")).toBe(1.25);
    expect(creditsForTask("mock", "gemini")).toBe(0);
    expect(creditsForTask(undefined, "chatgpt")).toBe(0);
  });

  it("estimates a mixed scan exactly", () => {
    const jobs = [{ engine: "chatgpt" }, { engine: "chatgpt" }, { engine: "gemini" }, { engine: "perplexity" }] as const;
    expect(estimateCredits("queryingai", [...jobs])).toBe(4.25);
    expect(estimateCredits("mock", [...jobs])).toBe(0);
    expect(estimateCredits("queryingai", [])).toBe(0);
  });

  it("has no limit when the budget is null", () => {
    expect(() => assertWithinBudget("Project", null, 1e9, 1e9)).not.toThrow();
  });

  it("allows up to and including the budget, refuses beyond it", () => {
    expect(() => assertWithinBudget("Project", 100, 60, 40)).not.toThrow();
    expect(() => assertWithinBudget("Project", 100, 60, 40.01)).toThrow(BudgetExceededError);
    expect(() => assertWithinBudget("Workspace", 10, 0, 11)).toThrow(/Workspace monthly credit budget/);
  });
});

describe("finalStatus", () => {
  it("maps outcomes", () => {
    expect(finalStatus(5, 0)).toBe("completed");
    expect(finalStatus(3, 2)).toBe("partial");
    expect(finalStatus(0, 4)).toBe("failed");
  });
});

describe("monthStartUtc", () => {
  it("returns the first of the month in UTC", () => {
    expect(monthStartUtc(new Date("2026-11-30T23:59:59Z"))).toBe("2026-11-01T00:00:00.000Z");
    expect(monthStartUtc(new Date("2026-12-01T00:00:00Z"))).toBe("2026-12-01T00:00:00.000Z");
  });
});

describe("mapPool", () => {
  it("keeps order and respects the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5 * (8 - n)));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles an empty list", async () => {
    expect(await mapPool([], 3, async (x) => x)).toEqual([]);
  });
});

describe("scanConcurrency", () => {
  it("defaults to the Free plan limit for querying.ai and is wider for the mock", () => {
    expect(scanConcurrency("queryingai", undefined)).toBe(2);
    expect(scanConcurrency(undefined, undefined)).toBe(5);
  });
  it("honours a valid QUERYING_CONCURRENCY, capped at 50", () => {
    expect(scanConcurrency("queryingai", "10")).toBe(10);
    expect(scanConcurrency("queryingai", "500")).toBe(50);
  });
  it("ignores junk values", () => {
    for (const bad of ["", "0", "-3", "abc", "2.5"]) expect(scanConcurrency("queryingai", bad)).toBe(2);
  });
});

describe("checkBudget", () => {
  it("returns null without a budget", () => {
    expect(checkBudget("Project", null, 5, 5)).toBeNull();
  });
  it("describes where a scan would leave the budget", () => {
    expect(checkBudget("Project", 20, 11.25, 10)).toEqual({
      label: "Project", budget: 20, committed: 11.25, estimate: 10, after: 21.25, remaining: 8.75, exceeded: true,
    });
    expect(checkBudget("Project", 20, 10, 10)).toMatchObject({ after: 20, remaining: 10, exceeded: false });
  });
  it("uses the same wording as the server-side refusal", () => {
    const s = checkBudget("Workspace", 5, 0, 12.5)!;
    expect(budgetMessage(s)).toBe("Workspace monthly credit budget would be exceeded: 0 used + 12.5 estimated > 5 budget.");
    expect(() => assertWithinBudget("Workspace", 5, 0, 12.5)).toThrow(budgetMessage(s));
  });
});
