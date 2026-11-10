import type { AnswerAnalysis, Citation, EngineAnswer, PromptResult, ScanSummary } from "./types";

/** What an answer is analysed against: one project's brand, domains and competitors. */
export interface AnalysisTarget {
  brand: string;
  /** Aliases and misspellings of the brand, any script. */
  aliases: string[];
  /** Client domains incl. subdomains, e.g. "shop.example.com". */
  domains: string[];
  competitors: { name: string; aliases?: string[]; domains?: string[] }[];
}

export type DomainRole = "client" | "competitor" | "other";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * First position of `term` in `text`, or -1. Uses Unicode-aware boundaries so
 * Arabic/Thai aliases work (a plain \b only understands ASCII word characters).
 */
function firstIndex(text: string, term: string): number {
  const t = term.trim();
  if (!t) return -1;
  const m = new RegExp(`(?<![\\p{L}\\p{N}_])${esc(t)}(?![\\p{L}\\p{N}_])`, "iu").exec(text);
  return m ? m.index : -1;
}

function earliest(text: string, terms: string[]): number {
  const hits = terms.map((t) => firstIndex(text, t)).filter((i) => i >= 0);
  return hits.length ? Math.min(...hits) : -1;
}

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

export function citationMatchesDomain(url: string, domain: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const d = normalizeDomain(domain);
    return !!d && (host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/** Hostname of a URL without "www.", or "" if it is not a valid URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Is a cited URL the client's, a tracked competitor's, or neither? */
export function classifySource(url: string, target: AnalysisTarget): DomainRole {
  if (target.domains.some((d) => citationMatchesDomain(url, d))) return "client";
  if (target.competitors.some((c) => (c.domains ?? []).some((d) => citationMatchesDomain(url, d)))) {
    return "competitor";
  }
  return "other";
}

export function analyze(target: AnalysisTarget, raw: EngineAnswer): AnswerAnalysis {
  const { answer, citations } = raw;
  const brandIdx = earliest(answer, [target.brand, ...target.aliases]);
  const domainInText = earliest(answer, target.domains.map(normalizeDomain)) >= 0;
  const brandMentioned = brandIdx >= 0 || domainInText;

  const competitorHits = target.competitors
    .map((c) => ({ name: c.name, idx: earliest(answer, [c.name, ...(c.aliases ?? [])]) }))
    .filter((c) => c.idx >= 0);

  let mentionRank: number | null = null;
  if (brandMentioned) {
    const brandPos = brandIdx >= 0 ? brandIdx : 0;
    mentionRank = 1 + competitorHits.filter((c) => c.idx < brandPos).length;
  }

  return {
    brandMentioned,
    mentionRank,
    domainCited: citations.some((c: Citation) =>
      target.domains.some((d) => citationMatchesDomain(c.url, d)),
    ),
    competitorsMentioned: competitorHits.map((c) => c.name),
  };
}

export function summarize(results: PromptResult[]): ScanSummary {
  const ok = results.filter((r) => !r.error);
  const rate = (rs: PromptResult[], f: (r: PromptResult) => boolean) =>
    rs.length ? rs.filter(f).length / rs.length : 0;

  const byEngine: ScanSummary["byEngine"] = {};
  for (const engine of new Set(ok.map((r) => r.engine))) {
    const rs = ok.filter((r) => r.engine === engine);
    byEngine[engine] = {
      total: rs.length,
      mentionRate: rate(rs, (r) => r.brandMentioned),
      citationRate: rate(rs, (r) => r.domainCited),
    };
  }
  return {
    total: ok.length,
    mentionRate: rate(ok, (r) => r.brandMentioned),
    citationRate: rate(ok, (r) => r.domainCited),
    byEngine,
  };
}
