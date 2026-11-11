import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SourceKind } from "./source-filters";

/** Citation analysis (FR-18). Runs as the signed-in user, so RLS decides what is visible. */

export interface SourceScope {
  /** Restrict to one scan run; omit for all scans. */
  scanRunId?: string | null;
  engine?: string | null;
  country?: string | null;
}

export interface SourceRow {
  /** The domain, or the full URL when grouped by page. */
  item: string;
  host: string;
  kind: SourceKind;
  citations: number;
  /** Distinct answers that cited it. */
  answers: number;
  byEngine: Record<string, number>;
}

export interface SourceSummary {
  answers: number;
  citations: number;
  domains: number;
  clientCitations: number;
  competitorCitations: number;
  otherCitations: number;
  answersCitingClient: number;
}

const EMPTY_SUMMARY: SourceSummary = {
  answers: 0, citations: 0, domains: 0, clientCitations: 0, competitorCitations: 0, otherCitations: 0, answersCitingClient: 0,
};

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what} failed: ${error.message}`);
}

const num = (v: unknown) => Number(v ?? 0);

export async function getSourceStats(
  projectId: string,
  opts: SourceScope & { role?: SourceKind | null; by?: "domain" | "url"; limit?: number } = {},
): Promise<SourceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("source_stats", {
    p_project: projectId,
    p_scan_run: opts.scanRunId ?? null,
    p_engine: opts.engine ?? null,
    p_country: opts.country ?? null,
    p_role: opts.role ?? null,
    p_by: opts.by ?? "domain",
    p_limit: opts.limit ?? 25,
  });
  if (error) fail("Loading source stats", error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    item: String(r.item),
    host: String(r.host),
    kind: r.kind as SourceKind,
    citations: num(r.citations),
    answers: num(r.answers),
    byEngine: Object.fromEntries(Object.entries((r.by_engine ?? {}) as Record<string, unknown>).map(([k, v]) => [k, num(v)])),
  }));
}

export async function getSourceSummary(projectId: string, opts: SourceScope = {}): Promise<SourceSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("source_summary", {
    p_project: projectId,
    p_scan_run: opts.scanRunId ?? null,
    p_engine: opts.engine ?? null,
    p_country: opts.country ?? null,
  });
  if (error) fail("Loading source summary", error);
  const r = ((Array.isArray(data) ? data[0] : data) ?? null) as Record<string, unknown> | null;
  if (!r) return EMPTY_SUMMARY;
  return {
    answers: num(r.answers),
    citations: num(r.citations),
    domains: num(r.domains),
    clientCitations: num(r.client_citations),
    competitorCitations: num(r.competitor_citations),
    otherCitations: num(r.other_citations),
    answersCitingClient: num(r.answers_citing_client),
  };
}
