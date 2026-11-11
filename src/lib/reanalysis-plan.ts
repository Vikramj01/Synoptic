import { analyze, classifySource, type AnalysisTarget, type DomainRole } from "./analysis";

/** One saved answer as stored in the database, with its current analysis and sources. */
export interface StoredAnswer {
  id: string;
  text: string;
  /** ISO timestamp; its UTC day decides which rollup row the answer counts in. */
  answeredAt: string;
  sources: { id: string; url: string; role: string }[];
  analysis: {
    brandMentioned: boolean;
    mentionRank: number | null;
    domainCited: boolean;
    competitorsMentioned: string[];
  } | null;
}

export interface ReanalysisPlan {
  /** Only answers whose analysis changed (or had none). */
  analyses: {
    answerId: string;
    brandMentioned: boolean;
    mentionRank: number | null;
    domainCited: boolean;
    competitorsMentioned: string[];
  }[];
  /** Source ids that should now carry each role (only those that changed). */
  roleUpdates: Record<DomainRole, string[]>;
  changedAnswers: number;
  changedSources: number;
  /** UTC days (YYYY-MM-DD) whose daily rollups must be refreshed. */
  days: string[];
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Recomputes analysis for saved answers against the project's current brand,
 * aliases, domains and competitors, and reports only what changed. Pure: uses
 * the same `analyze` as a live scan, so unchanged settings change nothing.
 */
export function planReanalysis(target: AnalysisTarget, answers: StoredAnswer[]): ReanalysisPlan {
  const plan: ReanalysisPlan = {
    analyses: [],
    roleUpdates: { client: [], competitor: [], other: [] },
    changedAnswers: 0,
    changedSources: 0,
    days: [],
  };
  const days = new Set<string>();

  for (const a of answers) {
    const next = analyze(target, { answer: a.text, citations: a.sources.map((s) => ({ url: s.url })) });
    const prev = a.analysis;
    const changed =
      !prev ||
      prev.brandMentioned !== next.brandMentioned ||
      prev.mentionRank !== next.mentionRank ||
      prev.domainCited !== next.domainCited ||
      !sameList(prev.competitorsMentioned, next.competitorsMentioned);
    if (changed) {
      plan.analyses.push({ answerId: a.id, ...next });
      days.add(new Date(a.answeredAt).toISOString().slice(0, 10));
    }

    for (const s of a.sources) {
      const role = classifySource(s.url, target);
      if (role !== s.role) {
        plan.roleUpdates[role].push(s.id);
        plan.changedSources++;
      }
    }
  }

  plan.changedAnswers = plan.analyses.length;
  plan.days = [...days].sort();
  return plan;
}
