import type { EngineAnswer, PromptResult, ScanInput, ScanSummary, Engine } from "./types";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function firstIndex(text: string, term: string): number {
  const m = new RegExp(`\\b${esc(term)}\\b`, "i").exec(text);
  return m ? m.index : -1;
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
    return host === d || host.endsWith(`.${d}`);
  } catch {
    return false;
  }
}

export function analyzeAnswer(
  input: ScanInput,
  prompt: string,
  engine: Engine,
  raw: EngineAnswer,
): PromptResult {
  const { answer, citations } = raw;
  const brandIdx = firstIndex(answer, input.brand);
  const domainInText = firstIndex(answer, normalizeDomain(input.domain)) >= 0;
  const brandMentioned = brandIdx >= 0 || domainInText;

  const competitorIdx = input.competitors
    .map((name) => ({ name, idx: firstIndex(answer, name) }))
    .filter((c) => c.idx >= 0);

  let mentionRank: number | null = null;
  if (brandMentioned) {
    const brandPos = brandIdx >= 0 ? brandIdx : 0;
    mentionRank = 1 + competitorIdx.filter((c) => c.idx < brandPos).length;
  }

  return {
    prompt,
    engine,
    answer,
    citations,
    brandMentioned,
    mentionRank,
    domainCited: citations.some((c) => citationMatchesDomain(c.url, input.domain)),
    competitorsMentioned: competitorIdx.map((c) => c.name),
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
