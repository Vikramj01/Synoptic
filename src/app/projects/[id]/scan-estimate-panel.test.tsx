import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { checkBudget } from "@/lib/scan-plan";
import { estimateFromJobs, evaluateScan, scanPricing } from "@/lib/scan-estimate";
import { ScanEstimatePanel } from "./scan-estimate-panel";

const paid = scanPricing({ PROVIDER: "queryingai" });
const free = scanPricing({ PROVIDER: "mock" });
const chatgpt = (n: number) => Array.from({ length: n }, () => ({ engine: "chatgpt" as const }));

function render(opts: {
  pricing: ReturnType<typeof scanPricing>;
  jobs: { engine: "chatgpt" | "gemini" }[];
  project?: number | null;
  used?: number;
  balance?: { remaining: number; plan: string | null } | null;
}) {
  const estimate = estimateFromJobs(opts.pricing, opts.jobs);
  const budgets = [checkBudget("Project", opts.project ?? null, opts.used ?? 0, estimate.credits)];
  const evaluation = evaluateScan({ estimate, budgets, balance: opts.balance?.remaining ?? null });
  return renderToStaticMarkup(
    <ScanEstimatePanel estimate={estimate} pricing={opts.pricing} evaluation={evaluation} budgets={budgets} balance={opts.balance ?? null} />,
  ).replace(/<!-- -->/g, "");
}

describe("ScanEstimatePanel", () => {
  it("shows queries, credits, time and a per-engine table", () => {
    const html = render({ pricing: paid, jobs: [...chatgpt(10), { engine: "gemini" }], balance: { remaining: 489.75, plan: "free" } });
    expect(html).toContain("11 queries");
    expect(html).toContain("about 11.25 credits");
    expect(html).toContain("2 at a time");
    expect(html).toMatch(/chatgpt<\/td><td[^>]*>10<\/td><td[^>]*>1<\/td><td[^>]*>10</);
    expect(html).toMatch(/gemini<\/td><td[^>]*>1<\/td><td[^>]*>1.25<\/td><td[^>]*>1.25</);
  });

  it("shows the budget after the scan and the balance after the scan", () => {
    const html = render({ pricing: paid, jobs: chatgpt(10), project: 20, used: 1.25, balance: { remaining: 489.75, plan: "free" } });
    expect(html).toContain("Project budget: 1.25 used this month + 10 for this scan");
    expect(html).toContain("11.25</strong> of 20");
    expect(html).toContain("8.75 left after this scan");
    expect(html).toContain("489.75 credits");
    expect(html).toContain("(free plan)");
    expect(html).toContain("479.75 after this scan");
    expect(html).not.toContain('role="alert"');
  });

  it("flags an over-budget scan with the same wording the server uses", () => {
    const html = render({ pricing: paid, jobs: chatgpt(10), project: 5 });
    expect(html).toContain("(over budget)");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Project monthly credit budget would be exceeded: 0 used + 10 estimated &gt; 5 budget.");
  });

  it("flags an insufficient querying.ai balance", () => {
    const html = render({ pricing: paid, jobs: chatgpt(10), balance: { remaining: 8, plan: null } });
    expect(html).toContain("Not enough querying.ai credits: this scan needs 10 but your balance is 8.");
    expect(html).not.toContain("plan)");
  });

  it("says so when the balance cannot be read, without blocking", () => {
    const html = render({ pricing: paid, jobs: chatgpt(3), balance: null });
    expect(html).toContain("querying.ai balance unavailable right now.");
    expect(html).not.toContain('role="alert"');
  });

  it("explains that the mock provider is free and hides the money details", () => {
    const html = render({ pricing: free, jobs: chatgpt(10), project: 1 });
    expect(html).toContain("10 queries");
    expect(html).toContain("no credits used (mock provider)");
    expect(html).not.toContain("budget");
    expect(html).not.toContain("balance");
    expect(html).not.toContain("<table");
  });

  it("handles an empty scan", () => {
    const html = render({ pricing: paid, jobs: [] });
    expect(html).toContain("0 queries");
    expect(html).toContain("Nothing to scan");
  });

  it("warns about long scans without blocking", () => {
    const html = render({ pricing: paid, jobs: chatgpt(100), balance: { remaining: 500, plan: "free" } });
    expect(html).toContain("may take about 21 min");
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });
});
