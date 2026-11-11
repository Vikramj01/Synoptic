import { describe, expect, it } from "vitest";
import { analyze, classifySource, type AnalysisTarget } from "./analysis";
import { planReanalysis, type StoredAnswer } from "./reanalysis-plan";

const target: AnalysisTarget = {
  brand: "OpenArt",
  aliases: [],
  domains: ["openart.ai"],
  competitors: [{ name: "Midjourney" }, { name: "Leonardo" }],
};

/** Builds a stored answer exactly as a live scan would have saved it under `at`. */
function saved(id: string, text: string, urls: string[], at: AnalysisTarget = target, answeredAt = "2026-11-11T07:16:11.000+00:00"): StoredAnswer {
  const a = analyze(at, { answer: text, citations: urls.map((url) => ({ url })) });
  return {
    id, text, answeredAt,
    sources: urls.map((url, i) => ({ id: `${id}-s${i}`, url, role: classifySource(url, at) })),
    analysis: { ...a },
  };
}

describe("planReanalysis", () => {
  it("changes nothing when the settings are unchanged (matches scan-time analysis)", () => {
    const answers = [
      saved("a1", "Try Midjourney, then OpenArt.", ["https://openart.ai/x", "https://zapier.com/y"]),
      saved("a2", "Leonardo is popular.", []),
    ];
    const plan = planReanalysis(target, answers);
    expect(plan.changedAnswers).toBe(0);
    expect(plan.changedSources).toBe(0);
    expect(plan.analyses).toEqual([]);
    expect(plan.days).toEqual([]);
  });

  it("picks up a newly added competitor, including rank shifts", () => {
    const answers = [saved("a1", "Ideogram first, then OpenArt, then Midjourney.", [])];
    // Ideogram is not a known competitor yet, so only Midjourney counts, and it comes after OpenArt.
    expect(answers[0].analysis).toMatchObject({ mentionRank: 1, competitorsMentioned: ["Midjourney"] });

    const withIdeogram: AnalysisTarget = { ...target, competitors: [...target.competitors, { name: "Ideogram" }] };
    const plan = planReanalysis(withIdeogram, answers);
    expect(plan.changedAnswers).toBe(1);
    expect(plan.analyses[0]).toMatchObject({
      answerId: "a1", brandMentioned: true, mentionRank: 2, competitorsMentioned: ["Midjourney", "Ideogram"],
    });
    expect(plan.days).toEqual(["2026-11-11"]);
  });

  it("picks up a newly added brand alias", () => {
    const answers = [saved("a1", "Many creators use Open Art Studio daily.", [])];
    expect(answers[0].analysis?.brandMentioned).toBe(false);

    const plan = planReanalysis({ ...target, aliases: ["Open Art Studio"] }, answers);
    expect(plan.analyses[0]).toMatchObject({ brandMentioned: true, mentionRank: 1 });
  });

  it("handles a removed competitor and a removed alias", () => {
    const withAlias: AnalysisTarget = { ...target, aliases: ["OA"] };
    const answers = [saved("a1", "Midjourney and OA are options.", [], withAlias)];
    expect(answers[0].analysis).toMatchObject({ brandMentioned: true, mentionRank: 2 });

    const plan = planReanalysis({ ...target, competitors: [{ name: "Leonardo" }] }, answers);
    expect(plan.analyses[0]).toMatchObject({ brandMentioned: false, mentionRank: null, competitorsMentioned: [] });
  });

  it("relabels sources when domains change, without touching analysis or rollups", () => {
    const answers = [saved("a1", "No brand names here.", ["https://ideogram.ai/a", "https://zapier.com/b"])];
    const plan = planReanalysis(
      { ...target, competitors: [...target.competitors, { name: "Ideogram", domains: ["ideogram.ai"] }] },
      answers,
    );
    expect(plan.roleUpdates.competitor).toEqual(["a1-s0"]);
    expect(plan.roleUpdates.client).toEqual([]);
    expect(plan.roleUpdates.other).toEqual([]);
    expect(plan.changedSources).toBe(1);
    expect(plan.changedAnswers).toBe(0);
    expect(plan.days).toEqual([]); // rollups only depend on analysis
  });

  it("flips domainCited and source role when a client domain is added", () => {
    const answers = [saved("a1", "x", ["https://shop.openart.store/p"])];
    const plan = planReanalysis({ ...target, domains: ["openart.ai", "openart.store"] }, answers);
    expect(plan.analyses[0]).toMatchObject({ domainCited: true });
    expect(plan.roleUpdates.client).toEqual(["a1-s0"]);
  });

  it("creates analysis for an answer that has none", () => {
    const a = saved("a1", "OpenArt rocks", []);
    const plan = planReanalysis(target, [{ ...a, analysis: null }]);
    expect(plan.changedAnswers).toBe(1);
    expect(plan.analyses[0]).toMatchObject({ brandMentioned: true });
  });

  it("collects the distinct UTC days of changed answers only, sorted", () => {
    const withMj: AnalysisTarget = { ...target, competitors: [{ name: "Leonardo" }] };
    const answers = [
      saved("d2", "OpenArt vs Midjourney", [], withMj, "2026-11-12T23:30:00.000+00:00"),
      saved("d1", "OpenArt vs Midjourney", [], withMj, "2026-11-10T01:00:00.000+00:00"),
      saved("d3", "OpenArt vs Midjourney", [], withMj, "2026-11-12T01:00:00.000+00:00"),
      saved("same", "Just Leonardo", [], withMj, "2026-11-20T01:00:00.000+00:00"),
    ];
    const plan = planReanalysis(target, answers); // target now includes Midjourney again
    expect(plan.changedAnswers).toBe(3);
    expect(plan.days).toEqual(["2026-11-10", "2026-11-12"]);
  });

  it("is idempotent: applying the plan's result and re-planning yields no changes", () => {
    const withIdeogram: AnalysisTarget = { ...target, competitors: [...target.competitors, { name: "Ideogram", domains: ["ideogram.ai"] }] };
    const answers = [saved("a1", "Ideogram, OpenArt, Midjourney", ["https://ideogram.ai/a"])];
    const plan = planReanalysis(withIdeogram, answers);
    const applied: StoredAnswer[] = answers.map((a) => ({
      ...a,
      analysis: plan.analyses.find((p) => p.answerId === a.id) ?? a.analysis,
      sources: a.sources.map((s) => ({ ...s, role: (["client", "competitor", "other"] as const).find((r) => plan.roleUpdates[r].includes(s.id)) ?? s.role })),
    }));
    expect(planReanalysis(withIdeogram, applied)).toMatchObject({ changedAnswers: 0, changedSources: 0 });
  });
});
