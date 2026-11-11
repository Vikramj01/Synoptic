/** Pure helpers for the "top cited sources" page: filter parsing, links and formatting. */

export type SourceKind = "client" | "competitor" | "other";

export interface SourceFilters {
  /** "latest" = the most recent scan, "all" = every saved scan. */
  scope: "latest" | "all";
  /** An engine code of this project, or null for all engines. */
  engine: string | null;
  /** Restrict to one kind of source, or null for all. */
  role: SourceKind | null;
  /** Group by domain or by individual page (URL). */
  by: "domain" | "url";
}

export const DEFAULT_FILTERS: SourceFilters = { scope: "latest", engine: null, role: null, by: "domain" };

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Reads URL search params defensively: anything unrecognised falls back to the default. */
export function parseSourceFilters(params: Params, engines: string[]): SourceFilters {
  const engine = first(params.engine);
  const role = first(params.type);
  return {
    scope: first(params.scope) === "all" ? "all" : "latest",
    engine: engine && engines.includes(engine) ? engine : null,
    role: role === "client" || role === "competitor" || role === "other" ? role : null,
    by: first(params.view) === "pages" ? "url" : "domain",
  };
}

/** Builds a link to the sources page with the given filters, omitting defaults to keep URLs short. */
export function sourcesHref(projectId: string, filters: SourceFilters): string {
  const q = new URLSearchParams();
  if (filters.scope !== DEFAULT_FILTERS.scope) q.set("scope", filters.scope);
  if (filters.engine) q.set("engine", filters.engine);
  if (filters.role) q.set("type", filters.role);
  if (filters.by === "url") q.set("view", "pages");
  const qs = q.toString();
  return `/projects/${projectId}/sources${qs ? `?${qs}` : ""}`;
}

/**
 * Cited URLs come from AI engines, so they are untrusted. Only http(s) URLs may
 * become clickable links; anything else (javascript:, data:, relative, malformed)
 * is shown as plain text.
 */
export function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Whole-number percentage, 0 when there is nothing to divide by. */
export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** "chatgpt 3 · gemini 1", biggest first. */
export function formatByEngine(byEngine: Record<string, number>): string {
  return Object.entries(byEngine)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([engine, n]) => `${engine} ${n}`)
    .join(" · ");
}
