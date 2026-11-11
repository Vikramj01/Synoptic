import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { analyze, classifySource, hostOf, summarize, type AnalysisTarget } from "./analysis";
import { getProvider } from "./providers";
import { getProjectConfig, getWorkspaceRole, type ProjectConfig } from "./projects";
import {
  assertWithinBudget, buildJobs, creditsForTask, estimateCredits, finalStatus, idempotencyKey,
  mapPool, monthStartUtc, scanConcurrency,
} from "./scan-plan";
import type { Engine, PromptResult, ScanSummary } from "./types";

/** A problem the user can act on (shown in the UI), as opposed to an unexpected failure. */
export class ScanError extends Error {}

type Admin = ReturnType<typeof createAdminClient>;

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} failed: ${res.error.message}`);
  return res.data;
}

function targetOf(config: ProjectConfig): AnalysisTarget {
  return {
    brand: config.brandName,
    aliases: config.brandAliases,
    domains: config.domains,
    competitors: config.competitors,
  };
}

/** Credits already committed this month (charged + held - released), via the usage view. */
async function committedCredits(admin: Admin, column: "project_id" | "workspace_id", id: string): Promise<number> {
  const rows = must(
    await admin
      .from("project_month_usage")
      .select("credits_committed")
      .eq(column, id)
      .gte("month", monthStartUtc()),
    "Reading credit usage",
  ) as { credits_committed: number | string | null }[];
  return rows.reduce((sum, r) => sum + Number(r.credits_committed ?? 0), 0);
}

async function enforceBudgets(admin: Admin, config: ProjectConfig, estimate: number): Promise<void> {
  if (estimate <= 0) return;
  const ws = must(
    await admin.from("workspaces").select("monthly_credit_budget").eq("id", config.workspaceId).single(),
    "Reading workspace budget",
  ) as { monthly_credit_budget: number | string | null };

  if (config.monthlyCreditBudget !== null) {
    assertWithinBudget("Project", config.monthlyCreditBudget, await committedCredits(admin, "project_id", config.id), estimate);
  }
  if (ws.monthly_credit_budget !== null) {
    assertWithinBudget("Workspace", Number(ws.monthly_credit_budget), await committedCredits(admin, "workspace_id", config.workspaceId), estimate);
  }
}

/**
 * Runs every active prompt x engine x market for a project and stores the run.
 *
 * Authorisation: the caller must be an operator or analyst of the project's
 * workspace (checked with their own session). Only then do we use the
 * service-role client, which is required to write scan tables, and every write
 * is scoped to this project/workspace.
 *
 * Runs inside the request (first slice). Long scans against a live provider
 * will need the async dispatcher.
 */
export async function runProjectScan(projectId: string, userId: string): Promise<{ scanRunId: string; status: string }> {
  const config = await getProjectConfig(projectId);
  if (!config) throw new ScanError("Project not found.");

  const role = await getWorkspaceRole(config.workspaceId);
  if (role !== "operator" && role !== "analyst") {
    throw new ScanError("You have read-only access to this workspace and cannot run scans.");
  }

  const jobs = buildJobs(config);
  if (jobs.length === 0) {
    throw new ScanError("Nothing to scan: the project needs at least one prompt, engine and market.");
  }

  const admin = createAdminClient();
  const estimate = estimateCredits(process.env.PROVIDER, jobs);
  await enforceBudgets(admin, config, estimate);

  const scanRunId = randomUUID();
  const base = { project_id: config.id, workspace_id: config.workspaceId };
  must(
    await admin.from("scan_runs").insert({
      id: scanRunId, ...base, trigger: "manual", status: "running",
      credits_estimated: estimate, created_by: userId, started_at: new Date().toISOString(),
    }),
    "Creating scan run",
  );

  const tasks = jobs.map((job) => ({
    job,
    row: {
      id: randomUUID(), scan_run_id: scanRunId, ...base,
      prompt_id: job.promptId, prompt_text: job.promptText, engine: job.engine, country: job.country,
      idempotency_key: idempotencyKey(scanRunId, job), status: "queued", attempts: 0, error: null as string | null,
      credits_estimated: creditsForTask(process.env.PROVIDER, job.engine), credits_charged: 0,
      submitted_at: null as string | null, completed_at: null as string | null,
    },
  }));

  try {
    must(await admin.from("tasks").insert(tasks.map((t) => t.row)), "Creating tasks");
    const priced = tasks.filter((t) => t.row.credits_estimated > 0);
    if (priced.length > 0) {
      must(
        await admin.from("credit_ledger").insert(
          priced.map((t) => ({ ...base, country: t.job.country, task_id: t.row.id, kind: "hold", credits: t.row.credits_estimated })),
        ),
        "Holding credits",
      );
    }

    const provider = getProvider();
    const outcomes = await mapPool(tasks, scanConcurrency(process.env.PROVIDER, process.env.QUERYING_CONCURRENCY), async (t) => {
      const submittedAt = new Date().toISOString();
      try {
        const answer = await provider.query(t.job.promptText, t.job.engine, t.job.country, { idempotencyKey: t.row.idempotency_key });
        return { t, submittedAt, answer, error: null as string | null };
      } catch (e) {
        return { t, submittedAt, answer: null, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) };
      }
    });

    // ---- persist results
    const target = targetOf(config);
    const now = new Date().toISOString();
    const answers: object[] = [], raws: object[] = [], sources: object[] = [], analyses: object[] = [], ledger: object[] = [];
    let succeeded = 0;

    for (const o of outcomes) {
      o.t.row.submitted_at = o.submittedAt;
      o.t.row.completed_at = now;
      const credits = o.t.row.credits_estimated;
      if (credits > 0) ledger.push({ ...base, country: o.t.job.country, task_id: o.t.row.id, kind: "release", credits });

      if (o.answer) {
        succeeded++;
        const answerId = randomUUID();
        const a = analyze(target, o.answer);
        o.t.row.status = "completed";
        o.t.row.credits_charged = credits;
        if (credits > 0) ledger.push({ ...base, country: o.t.job.country, task_id: o.t.row.id, kind: "charge", credits });

        answers.push({ id: answerId, task_id: o.t.row.id, ...base, engine: o.t.job.engine, country: o.t.job.country, text: o.answer.answer, answered_at: now });
        raws.push({ answer_id: answerId, workspace_id: config.workspaceId, raw: o.answer });
        analyses.push({
          answer_id: answerId, ...base, brand_mentioned: a.brandMentioned, mention_rank: a.mentionRank,
          domain_cited: a.domainCited, competitors_mentioned: a.competitorsMentioned,
        });
        o.answer.citations.forEach((c, i) => {
          const domain = hostOf(c.url);
          if (!domain) return;
          sources.push({ answer_id: answerId, ...base, url: c.url, domain, label: c.title ?? null, position: i + 1, domain_role: classifySource(c.url, target) });
        });
      } else {
        o.t.row.status = "failed";
        o.t.row.error = o.error;
      }
    }

    const insertAll = async (table: string, rows: object[]) => {
      if (rows.length) must(await admin.from(table).insert(rows), `Saving ${table}`);
    };
    await insertAll("answers", answers);
    await insertAll("answer_raw", raws);
    await insertAll("sources", sources);
    await insertAll("answer_analysis", analyses);
    must(await admin.from("tasks").upsert(outcomes.map((o) => o.t.row), { onConflict: "id" }), "Updating tasks");
    await insertAll("credit_ledger", ledger);
    if (answers.length) {
      must(await admin.rpc("refresh_daily_rollups", { p_project: config.id, p_day: now.slice(0, 10) }), "Updating rollups");
    }

    const failed = outcomes.length - succeeded;
    const status = finalStatus(succeeded, failed);
    must(
      await admin.from("scan_runs").update({
        status,
        credits_actual: Math.round(outcomes.reduce((sum, o) => sum + o.t.row.credits_charged, 0) * 100) / 100,
        finished_at: new Date().toISOString(),
      }).eq("id", scanRunId),
      "Finishing scan run",
    );
    return { scanRunId, status };
  } catch (e) {
    await abortRun(admin, scanRunId, base, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** Best effort: mark the run failed and release credits held for tasks that never settled. */
async function abortRun(
  admin: Admin, scanRunId: string, base: { project_id: string; workspace_id: string }, message: string,
): Promise<void> {
  try {
    const open = (await admin.from("tasks").select("id, country, credits_estimated").eq("scan_run_id", scanRunId).eq("status", "queued")).data ?? [];
    if (open.length) {
      await admin.from("tasks").update({ status: "failed", error: `Aborted: ${message}`.slice(0, 500) }).eq("scan_run_id", scanRunId).eq("status", "queued");
      const held = open.filter((t) => Number(t.credits_estimated) > 0);
      if (held.length) {
        await admin.from("credit_ledger").insert(held.map((t) => ({ ...base, country: t.country, task_id: t.id, kind: "release", credits: Number(t.credits_estimated) })));
      }
    }
    await admin.from("scan_runs").update({ status: "failed", finished_at: new Date().toISOString() }).eq("id", scanRunId);
  } catch (cleanupError) {
    console.error("abortRun failed:", cleanupError);
  }
}

// ------------------------------------------------------------------ reads (as the signed-in user, RLS applies)

export interface ScanRunSummary {
  id: string;
  status: string;
  trigger: string;
  createdAt: string;
  finishedAt: string | null;
  creditsEstimated: number;
  creditsActual: number;
}

const toRun = (r: Record<string, unknown>): ScanRunSummary => ({
  id: r.id as string,
  status: r.status as string,
  trigger: r.trigger as string,
  createdAt: r.created_at as string,
  finishedAt: (r.finished_at as string | null) ?? null,
  creditsEstimated: Number(r.credits_estimated ?? 0),
  creditsActual: Number(r.credits_actual ?? 0),
});

const RUN_COLUMNS = "id, status, trigger, created_at, finished_at, credits_estimated, credits_actual";

export async function listScanRuns(projectId: string, limit = 20): Promise<ScanRunSummary[]> {
  const supabase = await createClient();
  const rows = must(
    await supabase.from("scan_runs").select(RUN_COLUMNS).eq("project_id", projectId).order("created_at", { ascending: false }).limit(limit),
    "Loading scan runs",
  ) as Record<string, unknown>[];
  return rows.map(toRun);
}

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export interface ScanDetail {
  run: ScanRunSummary;
  results: PromptResult[];
  summary: ScanSummary;
}

/** Rebuilds a run (answers, analysis, sources) from the tables. null if missing or not visible. */
export async function getScanDetail(projectId: string, scanRunId: string): Promise<ScanDetail | null> {
  const supabase = await createClient();
  const run = must(
    await supabase.from("scan_runs").select(RUN_COLUMNS).eq("id", scanRunId).eq("project_id", projectId).maybeSingle(),
    "Loading scan run",
  ) as Record<string, unknown> | null;
  if (!run) return null;

  const tasks = must(
    await supabase
      .from("tasks")
      .select(
        `id, prompt_text, engine, country, status, error,
         answers(text, answer_analysis(brand_mentioned, mention_rank, domain_cited, competitors_mentioned), sources(url, label, position))`,
      )
      .eq("scan_run_id", scanRunId),
    "Loading tasks",
  ) as {
    prompt_text: string; engine: Engine; country: string; status: string; error: string | null;
    answers: unknown;
  }[];

  const results: PromptResult[] = tasks
    .map((t) => {
      const answer = one(t.answers as { text: string; answer_analysis: unknown; sources: { url: string; label: string | null; position: number }[] } | null);
      const a = one(answer?.answer_analysis as { brand_mentioned: boolean; mention_rank: number | null; domain_cited: boolean; competitors_mentioned: string[] } | null);
      return {
        prompt: t.prompt_text, engine: t.engine, country: t.country,
        answer: answer?.text ?? "",
        citations: [...(answer?.sources ?? [])].sort((x, y) => x.position - y.position).map((s) => ({ url: s.url, title: s.label ?? undefined })),
        brandMentioned: a?.brand_mentioned ?? false,
        mentionRank: a?.mention_rank ?? null,
        domainCited: a?.domain_cited ?? false,
        competitorsMentioned: a?.competitors_mentioned ?? [],
        error: t.status === "failed" ? (t.error ?? "Failed") : t.status === "completed" ? undefined : "Not finished",
      };
    })
    .sort((x, y) => x.prompt.localeCompare(y.prompt) || x.engine.localeCompare(y.engine) || x.country.localeCompare(y.country));

  return { run: toRun(run), results, summary: summarize(results) };
}

/** Credits committed this month for a project (shown next to its budget). */
export async function getMonthUsage(projectId: string): Promise<number> {
  const supabase = await createClient();
  const rows = must(
    await supabase.from("project_month_usage").select("credits_committed").eq("project_id", projectId).gte("month", monthStartUtc()),
    "Loading usage",
  ) as { credits_committed: number | string | null }[];
  return rows.reduce((s, r) => s + Number(r.credits_committed ?? 0), 0);
}
