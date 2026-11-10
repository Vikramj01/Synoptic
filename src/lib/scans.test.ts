import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectConfig } from "./projects";

vi.mock("server-only", () => ({}));

// ---- recording fake of the Supabase admin client
interface Op { table: string; op: string; payload?: unknown; filters: [string, unknown][] }
const h = vi.hoisted(() => ({
  ops: [] as Op[],
  failOn: null as string | null,
  workspaceBudget: null as number | null,
  usage: [] as { credits_committed: number }[],
  config: null as unknown,
  role: "operator" as string | null,
  provider: { query: async () => ({ answer: "", citations: [] }) } as {
    query: (p: string, e: string, c?: string) => Promise<{ answer: string; citations: { url: string; title?: string }[] }>;
  },
}));

function builder(table: string) {
  const s: Op = { table, op: "select", filters: [] };
  const b = {
    insert(rows: unknown) { s.op = "insert"; s.payload = rows; return b; },
    upsert(rows: unknown) { s.op = "upsert"; s.payload = rows; return b; },
    update(vals: unknown) { s.op = "update"; s.payload = vals; return b; },
    select() { return b; },
    eq(c: string, v: unknown) { s.filters.push([c, v]); return b; },
    gte(c: string, v: unknown) { s.filters.push([c, v]); return b; },
    single() { return b; },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      h.ops.push({ ...s });
      let out: { data: unknown; error: { message: string } | null } = { data: null, error: null };
      if (h.failOn === `${table}.${s.op}`) out = { data: null, error: { message: "boom" } };
      else if (s.op === "select" && table === "workspaces") out = { data: { monthly_credit_budget: h.workspaceBudget }, error: null };
      else if (s.op === "select" && table === "project_month_usage") out = { data: h.usage, error: null };
      else if (s.op === "select" && table === "tasks") {
        const inserted = h.ops.find((o) => o.table === "tasks" && o.op === "insert")?.payload as { id: string; country: string }[] | undefined;
        out = { data: (inserted ?? []).map((t) => ({ id: t.id, country: t.country })), error: null };
      }
      return Promise.resolve(out).then(res, rej);
    },
  };
  return b;
}
const admin = {
  from: (t: string) => builder(t),
  rpc(name: string, args: unknown) { const b = builder(`rpc:${name}`); b.insert(args); return b; },
};

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("./providers", () => ({ getProvider: () => h.provider }));
vi.mock("./projects", () => ({
  getProjectConfig: async () => h.config,
  getWorkspaceRole: async () => h.role,
}));

import { runProjectScan, ScanError } from "./scans";
import { BudgetExceededError } from "./scan-plan";

const config = (over: Partial<ProjectConfig> = {}): ProjectConfig => ({
  id: "11111111-1111-1111-1111-111111111111",
  workspaceId: "22222222-2222-2222-2222-222222222222",
  name: "P", brandName: "Example", brandAliases: [], domains: ["example.com"], monthlyCreditBudget: null,
  engines: ["chatgpt", "gemini"], markets: ["AE"],
  competitors: [{ name: "Acme", aliases: [], domains: ["acme.com"] }],
  prompts: [{ id: "33333333-3333-3333-3333-333333333333", text: "best X", countries: ["AE"] }],
  ...over,
});

const find = (table: string, op: string) => h.ops.filter((o) => o.table === table && o.op === op);
const rows = (table: string, op: string) => find(table, op).flatMap((o) => o.payload as Record<string, unknown>[]);

beforeEach(() => {
  h.ops.length = 0; h.failOn = null; h.workspaceBudget = null; h.usage = []; h.role = "operator";
  h.config = config();
  h.provider = {
    query: async (prompt, engine) => ({
      answer: engine === "chatgpt" ? "Try Acme then Example." : "Only Acme.",
      citations: [{ url: "https://acme.com/x", title: "Acme" }, { url: "https://www.example.com/y" }, { url: "not a url" }],
    }),
  };
  delete process.env.PROVIDER;
});

describe("runProjectScan", () => {
  it("stores run, tasks, answers, analysis and sources, then refreshes rollups", async () => {
    const r = await runProjectScan("p", "user-1");
    expect(r.status).toBe("completed");

    expect(find("scan_runs", "insert")[0].payload).toMatchObject({ status: "running", trigger: "manual", created_by: "user-1", credits_estimated: 0 });
    expect(rows("tasks", "insert")).toHaveLength(2); // 1 prompt x 2 engines x 1 market
    expect(rows("tasks", "upsert").every((t) => t.status === "completed")).toBe(true);
    expect(rows("answers", "insert")).toHaveLength(2);
    expect(rows("answer_raw", "insert")).toHaveLength(2);

    const analyses = rows("answer_analysis", "insert");
    expect(analyses.find((a) => a.mention_rank === 2)).toMatchObject({ brand_mentioned: true, domain_cited: true, competitors_mentioned: ["Acme"] });

    const sources = rows("sources", "insert");
    expect(sources).toHaveLength(4); // invalid URL skipped
    expect(sources.map((s) => s.domain_role).sort()).toEqual(["client", "client", "competitor", "competitor"]);

    expect(rows("credit_ledger", "insert")).toHaveLength(0); // mock provider is free
    expect(find("rpc:refresh_daily_rollups", "insert")).toHaveLength(1);
    expect(find("scan_runs", "update")[0].payload).toMatchObject({ status: "completed", credits_actual: 0 });
  });

  it("settles credits: hold, then release+charge on success and release on failure", async () => {
    process.env.PROVIDER = "queryingai";
    h.provider = {
      query: async (_p, engine) => {
        if (engine === "gemini") throw new Error("ENGINE_TIMEOUT");
        return { answer: "Example", citations: [] };
      },
    };
    const r = await runProjectScan("p", "user-1");
    expect(r.status).toBe("partial");

    const ledger = rows("credit_ledger", "insert");
    const count = (kind: string) => ledger.filter((l) => l.kind === kind).length;
    expect(count("hold")).toBe(2);
    expect(count("release")).toBe(2); // both holds released
    expect(count("charge")).toBe(1); // only the success is charged
    expect(ledger.find((l) => l.kind === "charge")).toMatchObject({ credits: 1.25 });

    const tasks = rows("tasks", "upsert");
    expect(tasks.find((t) => t.status === "failed")).toMatchObject({ error: "ENGINE_TIMEOUT", credits_charged: 0 });
    expect(find("scan_runs", "update")[0].payload).toMatchObject({ status: "partial", credits_actual: 1.25 });
  });

  it("marks the run failed and skips rollups when every task fails", async () => {
    h.provider = { query: async () => { throw new Error("down"); } };
    const r = await runProjectScan("p", "user-1");
    expect(r.status).toBe("failed");
    expect(rows("answers", "insert")).toHaveLength(0);
    expect(find("rpc:refresh_daily_rollups", "insert")).toHaveLength(0);
  });

  it("refuses read-only users before writing anything", async () => {
    h.role = "viewer";
    await expect(runProjectScan("p", "u")).rejects.toThrow(ScanError);
    expect(h.ops).toHaveLength(0);
    h.role = null;
    await expect(runProjectScan("p", "u")).rejects.toThrow(/read-only/);
  });

  it("reports a missing project and an empty plan", async () => {
    h.config = null;
    await expect(runProjectScan("p", "u")).rejects.toThrow(/not found/);
    h.config = config({ prompts: [] });
    await expect(runProjectScan("p", "u")).rejects.toThrow(/Nothing to scan/);
    expect(h.ops).toHaveLength(0);
  });

  it("enforces the project budget before creating a run", async () => {
    process.env.PROVIDER = "queryingai";
    h.config = config({ monthlyCreditBudget: 3 });
    h.usage = [{ credits_committed: 1 }]; // 1 used + 2.5 estimated > 3
    await expect(runProjectScan("p", "u")).rejects.toThrow(BudgetExceededError);
    expect(find("scan_runs", "insert")).toHaveLength(0);
  });

  it("enforces the workspace budget too", async () => {
    process.env.PROVIDER = "queryingai";
    h.workspaceBudget = 2;
    await expect(runProjectScan("p", "u")).rejects.toThrow(/Workspace monthly credit budget/);
    expect(find("scan_runs", "insert")).toHaveLength(0);
  });

  it("allows a scan that fits the budget", async () => {
    process.env.PROVIDER = "queryingai";
    h.config = config({ monthlyCreditBudget: 2.5 });
    expect((await runProjectScan("p", "u")).status).toBe("completed");
  });

  it("aborts cleanly when saving fails: run failed, open tasks failed, holds released", async () => {
    process.env.PROVIDER = "queryingai";
    h.failOn = "answers.insert";
    await expect(runProjectScan("p", "u")).rejects.toThrow(/Saving answers failed/);

    expect(find("tasks", "update")[0].payload).toMatchObject({ status: "failed" });
    const releases = rows("credit_ledger", "insert").filter((l) => l.kind === "release");
    expect(releases).toHaveLength(2);
    const lastRunUpdate = find("scan_runs", "update").at(-1);
    expect(lastRunUpdate?.payload).toMatchObject({ status: "failed" });
  });
});
