import "server-only";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import type { Engine } from "@/lib/types";

/** Everything below runs as the signed-in user, so RLS decides what they can see. */

export interface WorkspaceSummary {
  id: string;
  name: string;
  agencyId: string;
  monthlyCreditBudget: number | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  brandName: string;
  workspaceId: string;
  workspaceName: string;
}

export interface Country {
  code: string;
  name: string;
  region: string;
}

export interface ProjectConfig {
  id: string;
  workspaceId: string;
  name: string;
  brandName: string;
  brandAliases: string[];
  domains: string[];
  monthlyCreditBudget: number | null;
  engines: Engine[];
  markets: string[]; // active country codes
  competitors: { name: string; aliases: string[]; domains: string[] }[];
  prompts: { id: string; text: string; countries: string[] }[]; // active prompts, active markets
}

export type WorkspaceRole = "operator" | "analyst" | "viewer";

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what} failed: ${error.message}`);
}

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name, agency_id, monthly_credit_budget")
    .is("archived_at", null)
    .order("name");
  if (error) fail("Loading workspaces", error);
  return data.map((w) => ({
    id: w.id,
    name: w.name,
    agencyId: w.agency_id,
    monthlyCreditBudget: w.monthly_credit_budget === null ? null : Number(w.monthly_credit_budget),
  }));
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, brand_name, workspace_id, workspaces(name)")
    .is("archived_at", null)
    .order("name");
  if (error) fail("Loading projects", error);
  return data.map((p) => {
    const ws = p.workspaces as { name: string } | { name: string }[] | null;
    return {
      id: p.id,
      name: p.name,
      brandName: p.brand_name,
      workspaceId: p.workspace_id,
      workspaceName: (Array.isArray(ws) ? ws[0]?.name : ws?.name) ?? "",
    };
  });
}

export async function listCountries(): Promise<Country[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("countries")
    .select("code, name, region")
    .eq("active", true)
    .order("region")
    .order("name");
  if (error) fail("Loading markets", error);
  return data;
}

export async function listEngines(): Promise<{ code: Engine; label: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("engines").select("code, label").eq("active", true).order("label");
  if (error) fail("Loading engines", error);
  return data as { code: Engine; label: string }[];
}

/** The caller's role in a workspace, or null if they have no access. */
export async function getWorkspaceRole(workspaceId: string): Promise<WorkspaceRole | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("workspace_role", { p_workspace: workspaceId });
  if (error) fail("Checking access", error);
  return (data as WorkspaceRole | null) ?? null;
}

/** The agency the caller operates, if any (needed to create workspaces). */
export async function getOperatorAgencyId(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agency_members")
    .select("agency_id")
    .eq("user_id", userId)
    .eq("role", "operator")
    .limit(1);
  if (error) fail("Checking agency role", error);
  return data[0]?.agency_id ?? null;
}

/** Loads a project and its scan configuration, or null if it doesn't exist / isn't visible. */
export async function getProjectConfig(projectId: string): Promise<ProjectConfig | null> {
  const supabase = await createClient();
  const { data: p, error } = await supabase
    .from("projects")
    .select(
      `id, workspace_id, name, brand_name, brand_aliases, domains, monthly_credit_budget, archived_at,
       project_engines(engine),
       project_markets(country, active),
       competitors(name, aliases, domains),
       prompts(id, text, active, prompt_markets(country, active))`,
    )
    .eq("id", projectId)
    .maybeSingle();
  if (error) fail("Loading project", error);
  if (!p || p.archived_at) return null;

  const markets = p.project_markets.filter((m) => m.active).map((m) => m.country);
  const activeMarkets = new Set(markets);
  return {
    id: p.id,
    workspaceId: p.workspace_id,
    name: p.name,
    brandName: p.brand_name,
    brandAliases: p.brand_aliases,
    domains: p.domains,
    monthlyCreditBudget: p.monthly_credit_budget === null ? null : Number(p.monthly_credit_budget),
    engines: p.project_engines.map((e) => e.engine as Engine),
    markets,
    competitors: p.competitors.map((c) => ({ name: c.name, aliases: c.aliases, domains: c.domains })),
    prompts: p.prompts
      .filter((pr) => pr.active)
      .map((pr) => ({
        id: pr.id,
        text: pr.text,
        countries: pr.prompt_markets.filter((m) => m.active && activeMarkets.has(m.country)).map((m) => m.country),
      })),
  };
}

export interface NewProjectInput {
  workspaceId: string;
  name: string;
  brandName: string;
  brandAliases: string[];
  domains: string[];
  engines: string[];
  countries: string[];
  competitors: string[];
  prompts: string[];
  monthlyCreditBudget: number | null;
}

/**
 * Creates a workspace as the agency operator. Returns its id.
 *
 * The id is generated here and the insert does NOT ask for the row back:
 * INSERT ... RETURNING re-checks the SELECT policy on the new row, and that
 * policy reads the workspace through a helper that cannot yet see a row created
 * by the statement still running, so the insert would be rejected by RLS.
 */
export async function createWorkspace(agencyId: string, name: string): Promise<string> {
  const supabase = await createClient();
  const id = randomUUID();
  const { error } = await supabase.from("workspaces").insert({ id, agency_id: agencyId, name });
  if (error) fail("Creating workspace", error);
  return id;
}

/** Atomic project + children creation (SQL function; RLS applies). Returns the project id. */
export async function createProject(input: NewProjectInput): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_project", {
    p_workspace: input.workspaceId,
    p_name: input.name,
    p_brand_name: input.brandName,
    p_brand_aliases: input.brandAliases,
    p_domains: input.domains,
    p_engines: input.engines,
    p_countries: input.countries,
    p_competitors: input.competitors,
    p_prompts: input.prompts,
    ...(input.monthlyCreditBudget === null ? {} : { p_monthly_credit_budget: input.monthlyCreditBudget }),
  });
  if (error) fail("Creating project", error);
  return data as string;
}
