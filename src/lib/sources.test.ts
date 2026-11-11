import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  result: { data: null as unknown, error: null as { message: string } | null },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.calls.push({ fn, args });
      return h.result;
    },
  }),
}));

import { getSourceStats, getSourceSummary } from "./sources";

beforeEach(() => { h.calls.length = 0; h.result = { data: null, error: null }; });

describe("getSourceStats", () => {
  it("maps rows (bigints arrive as numbers or strings) and passes the scope through", async () => {
    h.result.data = [
      { item: "zapier.com", host: "zapier.com", kind: "other", citations: "4", answers: 3, by_engine: { chatgpt: 3, gemini: "1" } },
      { item: "openart.ai", host: "openart.ai", kind: "client", citations: 2, answers: 2, by_engine: null },
    ];
    const rows = await getSourceStats("proj", { scanRunId: "run-1", engine: "chatgpt", role: "client", by: "url", limit: 10 });
    expect(rows).toEqual([
      { item: "zapier.com", host: "zapier.com", kind: "other", citations: 4, answers: 3, byEngine: { chatgpt: 3, gemini: 1 } },
      { item: "openart.ai", host: "openart.ai", kind: "client", citations: 2, answers: 2, byEngine: {} },
    ]);
    expect(h.calls[0]).toEqual({
      fn: "source_stats",
      args: { p_project: "proj", p_scan_run: "run-1", p_engine: "chatgpt", p_country: null, p_role: "client", p_by: "url", p_limit: 10 },
    });
  });

  it("uses all-scans, all-engines, by-domain defaults", async () => {
    await getSourceStats("proj");
    expect(h.calls[0].args).toEqual({ p_project: "proj", p_scan_run: null, p_engine: null, p_country: null, p_role: null, p_by: "domain", p_limit: 25 });
  });

  it("returns an empty list when there are no rows and surfaces errors", async () => {
    h.result.data = null;
    expect(await getSourceStats("proj")).toEqual([]);
    h.result.error = { message: "permission denied" };
    await expect(getSourceStats("proj")).rejects.toThrow(/Loading source stats failed: permission denied/);
  });
});

describe("getSourceSummary", () => {
  it("maps the single summary row, whether it arrives as an array or an object", async () => {
    const row = { answers: 4, citations: "7", domains: 3, client_citations: 2, competitor_citations: 1, other_citations: 4, answers_citing_client: 2 };
    const expected = { answers: 4, citations: 7, domains: 3, clientCitations: 2, competitorCitations: 1, otherCitations: 4, answersCitingClient: 2 };
    h.result.data = [row];
    expect(await getSourceSummary("proj")).toEqual(expected);
    h.result.data = row;
    expect(await getSourceSummary("proj")).toEqual(expected);
  });

  it("returns zeros when nothing comes back", async () => {
    h.result.data = [];
    expect(await getSourceSummary("proj")).toMatchObject({ answers: 0, citations: 0, answersCitingClient: 0 });
  });

  it("surfaces errors", async () => {
    h.result.error = { message: "boom" };
    await expect(getSourceSummary("proj")).rejects.toThrow(/Loading source summary failed: boom/);
  });
});
