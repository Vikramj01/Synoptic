import { describe, expect, it } from "vitest";
import {
  assertWithinBudget, BudgetExceededError, buildJobs, creditsPerTask, finalStatus,
  idempotencyKey, mapPool, monthStartUtc,
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
  it("only queryingai costs credits", () => {
    expect(creditsPerTask("queryingai")).toBe(1.25);
    expect(creditsPerTask("mock")).toBe(0);
    expect(creditsPerTask(undefined)).toBe(0);
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
