import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProjectConfig, getWorkspaceRole } from "./projects";
import { planReanalysis, type StoredAnswer } from "./reanalysis-plan";
import { ScanError } from "./scans";

const PAGE = 200;

export interface ReanalysisResult {
  answers: number;
  changedAnswers: number;
  changedSources: number;
  daysRefreshed: number;
}

type Admin = ReturnType<typeof createAdminClient>;

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} failed: ${res.error.message}`);
  return res.data;
}

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

interface Row {
  id: string;
  text: string;
  answered_at: string;
  answer_analysis: unknown;
  sources: { id: string; url: string; domain_role: string }[] | null;
}

/**
 * Recomputes mentions, ranks, citations and source labels for every saved
 * answer of a project, using the project's CURRENT brand, aliases, domains and
 * competitors. Free: it never calls the provider, only re-reads stored text.
 *
 * Authorisation: operator or analyst of the project's workspace (checked as the
 * user). Writes then use the service-role client, scoped to this project.
 */
export async function reanalyzeProject(projectId: string): Promise<ReanalysisResult> {
  const config = await getProjectConfig(projectId);
  if (!config) throw new ScanError("Project not found.");

  const role = await getWorkspaceRole(config.workspaceId);
  if (role !== "operator" && role !== "analyst") {
    throw new ScanError("You have read-only access to this workspace and cannot re-analyze scans.");
  }

  const admin: Admin = createAdminClient();
  const target = {
    brand: config.brandName,
    aliases: config.brandAliases,
    domains: config.domains,
    competitors: config.competitors,
  };

  const result: ReanalysisResult = { answers: 0, changedAnswers: 0, changedSources: 0, daysRefreshed: 0 };
  const days = new Set<string>();
  const scope = { project_id: config.id, workspace_id: config.workspaceId };

  for (let from = 0; ; from += PAGE) {
    const rows = must(
      await admin
        .from("answers")
        .select(
          "id, text, answered_at, answer_analysis(brand_mentioned, mention_rank, domain_cited, competitors_mentioned), sources(id, url, domain_role)",
        )
        .eq("project_id", config.id)
        .order("id")
        .range(from, from + PAGE - 1),
      "Loading saved answers",
    ) as Row[];
    if (rows.length === 0) break;

    const stored: StoredAnswer[] = rows.map((r) => {
      const a = one(r.answer_analysis as { brand_mentioned: boolean; mention_rank: number | null; domain_cited: boolean; competitors_mentioned: string[] } | null);
      return {
        id: r.id,
        text: r.text,
        answeredAt: r.answered_at,
        sources: (r.sources ?? []).map((s) => ({ id: s.id, url: s.url, role: s.domain_role })),
        analysis: a
          ? { brandMentioned: a.brand_mentioned, mentionRank: a.mention_rank, domainCited: a.domain_cited, competitorsMentioned: a.competitors_mentioned }
          : null,
      };
    });
    const plan = planReanalysis(target, stored);

    if (plan.analyses.length) {
      must(
        await admin.from("answer_analysis").upsert(
          plan.analyses.map((a) => ({
            answer_id: a.answerId, ...scope,
            brand_mentioned: a.brandMentioned, mention_rank: a.mentionRank,
            domain_cited: a.domainCited, competitors_mentioned: a.competitorsMentioned,
            analysed_at: new Date().toISOString(),
          })),
          { onConflict: "answer_id" },
        ),
        "Saving analysis",
      );
    }
    for (const role of ["client", "competitor", "other"] as const) {
      const ids = plan.roleUpdates[role];
      if (ids.length) {
        must(
          await admin.from("sources").update({ domain_role: role }).in("id", ids).eq("project_id", config.id),
          "Relabelling sources",
        );
      }
    }

    result.answers += rows.length;
    result.changedAnswers += plan.changedAnswers;
    result.changedSources += plan.changedSources;
    plan.days.forEach((d) => days.add(d));
    if (rows.length < PAGE) break;
  }

  // Rollups depend only on analysis, so refresh just the days whose analysis changed.
  for (const day of days) {
    must(await admin.rpc("refresh_daily_rollups", { p_project: config.id, p_day: day }), "Updating rollups");
  }
  result.daysRefreshed = days.size;
  return result;
}
