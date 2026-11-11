import { normalizeDomain } from "./analysis";

/**
 * A competitor line in the project form:
 *
 *   Name
 *   Name | domain1, domain2
 *   Name | domain1, domain2 | alias1, alias2
 *   Name || alias1            (aliases without domains)
 */
export interface CompetitorInput {
  name: string;
  domains: string[];
  aliases: string[];
}

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/;
export const isHostname = (d: string) => HOSTNAME.test(d);

const MAX_NAME = 100;

/** Case-insensitive de-duplication that keeps the first spelling. */
function unique(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = i.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function parseCompetitorLines(text: string): { competitors: CompetitorInput[] } | { error: string } {
  const competitors: CompetitorInput[] = [];
  const seenNames = new Set<string>();

  const rows = text.split("\n").map((l, i) => ({ line: l.trim(), n: i + 1 })).filter((r) => r.line);
  for (const { line, n } of rows) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length > 3) return { error: `Competitor line "${line}": use at most two "|" separators (name | domains | aliases).` };

    const name = parts[0];
    if (!name) return { error: `Competitor line "${line}" is missing a name before the "|".` };
    if (name.length > MAX_NAME) return { error: `Competitor name "${name.slice(0, 30)}…" is too long.` };
    const key = name.toLowerCase();
    if (seenNames.has(key)) return { error: `Competitor "${name}" is listed twice.` };
    seenNames.add(key);

    const rawDomains = (parts[1] ?? "").split(/[,;\s]+/).filter(Boolean).map(normalizeDomain);
    const bad = rawDomains.find((d) => !isHostname(d));
    if (bad) return { error: `Competitor "${name}" (line ${n}): "${bad}" is not a valid domain.` };

    const aliases = unique((parts[2] ?? "").split(/[,;]+/).map((a) => a.trim()).filter(Boolean)).filter(
      (a) => a.toLowerCase() !== key,
    );
    competitors.push({ name, domains: unique(rawDomains), aliases });
  }
  return { competitors };
}

/** The inverse of parseCompetitorLines, for pre-filling the edit form. */
export function formatCompetitorLines(competitors: CompetitorInput[]): string {
  return competitors
    .map((c) => {
      if (c.aliases.length) return `${c.name} | ${c.domains.join(", ")} | ${c.aliases.join(", ")}`;
      if (c.domains.length) return `${c.name} | ${c.domains.join(", ")}`;
      return c.name;
    })
    .join("\n");
}
