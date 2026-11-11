"use server";

import { redirect } from "next/navigation";
import { normalizeDomain } from "@/lib/analysis";
import { requireUser } from "@/lib/auth";
import {
  createProject, createWorkspace, getOperatorAgencyId, listCountries, listEngines,
} from "@/lib/projects";
import { BudgetExceededError } from "@/lib/scan-plan";
import { runProjectScan, ScanError } from "@/lib/scans";

export interface ProjectFormValues {
  workspaceId: string;
  newWorkspace: string;
  name: string;
  brandName: string;
  brandAliases: string;
  domains: string;
  competitors: string;
  prompts: string;
  budget: string;
  engines: string[];
  countries: string[];
}

export interface ProjectFormState {
  error?: string;
  /** Echoed back so the form keeps what the user typed after a validation error. */
  values?: ProjectFormValues;
}

export interface RunScanState {
  error?: string;
}

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const lines = (s: string) => [...new Set(s.split("\n").map((x) => x.trim()).filter(Boolean))];
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/;

export async function createProjectAction(_prev: ProjectFormState, fd: FormData): Promise<ProjectFormState> {
  const user = await requireUser();

  const values: ProjectFormValues = {
    workspaceId: text(fd, "workspaceId"),
    newWorkspace: text(fd, "newWorkspace"),
    name: text(fd, "name"),
    brandName: text(fd, "brandName"),
    brandAliases: String(fd.get("brandAliases") ?? ""),
    domains: String(fd.get("domains") ?? ""),
    competitors: String(fd.get("competitors") ?? ""),
    prompts: String(fd.get("prompts") ?? ""),
    budget: text(fd, "budget"),
    engines: fd.getAll("engines").map(String),
    countries: fd.getAll("countries").map(String),
  };
  const fail = (error: string): ProjectFormState => ({ error, values });

  if (!values.workspaceId && !values.newWorkspace) return fail("Choose a workspace or name a new one.");
  if (!values.name) return fail("Give the project a name.");
  if (!values.brandName) return fail("Enter the brand name.");

  const domains = lines(values.domains).map(normalizeDomain);
  const badDomain = domains.find((d) => !HOSTNAME.test(d));
  if (domains.length === 0) return fail("Add at least one domain, e.g. example.com.");
  if (badDomain) return fail(`"${badDomain}" is not a valid domain.`);

  const prompts = lines(values.prompts);
  if (prompts.length === 0) return fail("Add at least one prompt.");

  const [engines, countries] = await Promise.all([listEngines(), listCountries()]);
  if (values.engines.length === 0) return fail("Select at least one engine.");
  if (values.countries.length === 0) return fail("Select at least one market.");
  if (values.engines.some((e) => !engines.some((x) => x.code === e))) return fail("Unknown engine selected.");
  if (values.countries.some((c) => !countries.some((x) => x.code === c))) return fail("Unknown market selected.");

  let budget: number | null = null;
  if (values.budget) {
    budget = Number(values.budget);
    if (!Number.isFinite(budget) || budget < 0) return fail("The credit budget must be a positive number.");
  }

  const permissionDenied = (e: unknown) => /row-level security|permission denied/i.test(e instanceof Error ? e.message : String(e));

  let workspaceId = values.workspaceId;
  if (!workspaceId) {
    try {
      const agencyId = await getOperatorAgencyId(user.id);
      if (!agencyId) return fail("Only agency operators can create new workspaces.");
      workspaceId = await createWorkspace(agencyId, values.newWorkspace);
    } catch (e) {
      if (permissionDenied(e)) return fail("You don't have permission to create workspaces.");
      console.error("createProjectAction (workspace):", e);
      return fail("Could not create the workspace. Please try again.");
    }
  }

  let projectId: string;
  try {
    projectId = await createProject({
      workspaceId, name: values.name, brandName: values.brandName,
      brandAliases: lines(values.brandAliases), domains,
      engines: values.engines, countries: values.countries,
      competitors: lines(values.competitors), prompts, monthlyCreditBudget: budget,
    });
  } catch (e) {
    if (permissionDenied(e)) {
      return fail("You don't have permission to create projects in that workspace.");
    }
    console.error("createProjectAction:", e);
    return fail("Could not create the project. Please try again.");
  }
  redirect(`/projects/${projectId}`);
}

export async function runScanAction(projectId: string): Promise<RunScanState> {
  const user = await requireUser();
  let scanRunId: string;
  try {
    ({ scanRunId } = await runProjectScan(projectId, user.id));
  } catch (e) {
    if (e instanceof ScanError || e instanceof BudgetExceededError) return { error: e.message };
    console.error("runScanAction:", e);
    return { error: "The scan failed unexpectedly. Check the server log." };
  }
  redirect(`/projects/${projectId}?run=${scanRunId}`);
}
