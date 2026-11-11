import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectConfig } from "./projects";

vi.mock("server-only", () => ({}));

interface Op { table: string; op: string; payload?: unknown; filters: [string, unknown][] }
const h = vi.hoisted(() => ({
  ops: [] as Op[],
  answers: [] as unknown[],
  failOn: null as string | null,
  config: null as unknown,
  role: "operator" as string | null,
}));

function builder(table: string) {
  const s: Op = { table, op: "select", filters: [] };
  let range: [number, number] | null = null;
  const b = {
    select() { return b; },
    upsert(rows: unknown) { s.op = "upsert"; s.payload = rows; return b; },
    update(vals: unknown) { s.op = "update"; s.payload = vals; return b; },
    eq(c: string, v: unknown) { s.filters.push([c, v]); return b; },
    in(c: string, v: unknown) { s.filters.push([c, v]); return b; },
    order() { return b; },
    range(a: number, z: number) { range = [a, z]; return b; },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      h.ops.push({ ...s });
      let out: { data: unknown; error: { message: string } | null } = { data: null, error: null };
      if (h.failOn === `${table}.${s.op}`) out = { data: null, error: { message: "boom" } };
      else if (s.op === "select" && table === "answers") out = { data: range ? h.answers.slice(range[0], range[1] + 1) : h.answers, error: null };
      return Promise.resolve(out).then(res, rej);
    },
  };
  return b;
}
const admin = {
  from: (t: string) => builder(t),
  rpc(name: string, args: unknown) { const b = builder(`rpc:${name}`); b.upsert(args); return b; },
};

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("./providers", () => ({ getProvider: () => ({}) }));
vi.mock("./projects", () => ({ getProjectConfig: async () => h.config, getWorkspaceRole: async () => h.role }));

import { reanalyzeProject } from "./reanalysis";
import { ScanError } from "./scans";

const config = (over: Partial<ProjectConfig> = {}): ProjectConfig => ({
  id: "11111111-1111-1111-1111-111111111111",
  workspaceId: "22222222-2222-2222-2222-222222222222",
  name: "P", brandName: "OpenArt", brandAliases: [], domains: ["openart.ai"], monthlyCreditBudget: null,
  engines: ["chatgpt"], markets: ["US"],
  competitors: [{ name: "Midjourney", aliases: [], domains: [] }],
  prompts: [], ...over,
});

/** A stored answer row as PostgREST returns it, analysed under the default config. */
const row = (id: string, text: string, opts: { mentioned?: boolean; rank?: number | null; comps?: string[]; at?: string; sources?: { id: string; url: string; domain_role: string }[] } = {}) => ({
  id, text, answered_at: opts.at ?? "2026-11-11T07:00:00+00:00",
  answer_analysis: {
    brand_mentioned: opts.mentioned ?? false, mention_rank: opts.rank ?? null,
    domain_cited: false, competitors_mentioned: opts.comps ?? [],
  },
  sources: opts.sources ?? [],
});

const writes = () => h.ops.filter((o) => o.op !== "select");
const find = (table: string, op: string) => h.ops.filter((o) => o.table === table && o.op === op);

beforeEach(() => {
  h.ops.length = 0; h.answers = []; h.failOn = null; h.role = "operator"; h.config = config();
});

describe("reanalyzeProject", () => {
  it("writes nothing when the saved analysis already matches the current settings", async () => {
    h.answers = [row("a1", "Midjourney is good", { comps: ["Midjourney"] }), row("a2", "OpenArt rocks", { mentioned: true, rank: 1 })];
    const r = await reanalyzeProject("p");
    expect(r).toMatchObject({ answers: 2, changedAnswers: 0, changedSources: 0, daysRefreshed: 0 });
    expect(writes()).toHaveLength(0);
  });

  it("upserts only the changed answers, scoped to the project, then refreshes the affected days", async () => {
    h.config = config({ competitors: [{ name: "Midjourney", aliases: [], domains: [] }, { name: "Ideogram", aliases: [], domains: [] }] });
    h.answers = [
      row("a1", "Ideogram then OpenArt", { mentioned: true, rank: 1, at: "2026-11-11T07:00:00+00:00" }), // rank becomes 2
      row("a2", "Nothing relevant", { at: "2026-11-12T07:00:00+00:00" }), // unchanged
    ];
    const r = await reanalyzeProject("p");
    expect(r).toMatchObject({ answers: 2, changedAnswers: 1, daysRefreshed: 1 });

    const up = find("answer_analysis", "upsert")[0];
    const rows = up.payload as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      answer_id: "a1", project_id: "11111111-1111-1111-1111-111111111111", workspace_id: "22222222-2222-2222-2222-222222222222",
      brand_mentioned: true, mention_rank: 2, competitors_mentioned: ["Ideogram"],
    });
    const rpcs = find("rpc:refresh_daily_rollups", "upsert");
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].payload).toEqual({ p_project: "11111111-1111-1111-1111-111111111111", p_day: "2026-11-11" });
  });

  it("relabels changed sources by role, scoped to the project, and skips rollups for label-only changes", async () => {
    h.config = config({ competitors: [{ name: "Midjourney", aliases: [], domains: [] }, { name: "Ideogram", aliases: [], domains: ["ideogram.ai"] }] });
    h.answers = [row("a1", "No names", { sources: [{ id: "s1", url: "https://ideogram.ai/x", domain_role: "other" }, { id: "s2", url: "https://zapier.com/y", domain_role: "other" }] })];
    const r = await reanalyzeProject("p");
    expect(r).toMatchObject({ changedAnswers: 0, changedSources: 1, daysRefreshed: 0 });

    const upd = find("sources", "update");
    expect(upd).toHaveLength(1);
    expect(upd[0].payload).toEqual({ domain_role: "competitor" });
    expect(upd[0].filters).toEqual([["id", ["s1"]], ["project_id", "11111111-1111-1111-1111-111111111111"]]);
    expect(find("rpc:refresh_daily_rollups", "upsert")).toHaveLength(0);
  });

  it("pages through large projects", async () => {
    h.config = config({ competitors: [{ name: "Midjourney", aliases: [], domains: [] }, { name: "Ideogram", aliases: [], domains: [] }] });
    h.answers = Array.from({ length: 450 }, (_, i) => row(`a${String(i).padStart(3, "0")}`, "Ideogram only", { comps: [] }));
    const r = await reanalyzeProject("p");
    expect(r).toMatchObject({ answers: 450, changedAnswers: 450 });
    expect(find("answers", "select")).toHaveLength(3); // 200 + 200 + 50
    expect(find("answer_analysis", "upsert")).toHaveLength(3);
    expect(find("rpc:refresh_daily_rollups", "upsert")).toHaveLength(1); // one day, refreshed once at the end
  });

  it("handles a project with no saved answers", async () => {
    expect(await reanalyzeProject("p")).toMatchObject({ answers: 0, changedAnswers: 0 });
    expect(writes()).toHaveLength(0);
  });

  it("refuses read-only users and unknown projects before reading any answers", async () => {
    h.role = "viewer";
    await expect(reanalyzeProject("p")).rejects.toThrow(ScanError);
    h.role = null;
    await expect(reanalyzeProject("p")).rejects.toThrow(/read-only/);
    h.config = null;
    await expect(reanalyzeProject("p")).rejects.toThrow(/not found/);
    expect(h.ops).toHaveLength(0);
  });

  it("surfaces a database failure instead of reporting success", async () => {
    h.config = config({ competitors: [{ name: "Ideogram", aliases: [], domains: [] }] });
    h.answers = [row("a1", "Ideogram", { comps: [] })];
    h.failOn = "answer_analysis.upsert";
    await expect(reanalyzeProject("p")).rejects.toThrow(/Saving analysis failed/);
    expect(find("rpc:refresh_daily_rollups", "upsert")).toHaveLength(0);
  });
});
