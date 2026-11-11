import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { formatCompetitorLines } from "@/lib/competitors";
import { getProjectConfig, getWorkspaceRole, listCountries, listEngines } from "@/lib/projects";
import { updateProjectAction, type ProjectFormValues } from "../../actions";
import { ProjectForm } from "../../new/project-form";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <Editor params={params} />
      </Suspense>
    </main>
  );
}

async function Editor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  await requireUser();

  const config = await getProjectConfig(id);
  if (!config) notFound();
  const [role, engines, countries] = await Promise.all([getWorkspaceRole(config.workspaceId), listEngines(), listCountries()]);
  const back = `/projects/${config.id}`;

  const header = (
    <header className="space-y-1">
      <Link href={back} className="text-xs text-neutral-500 underline">← Back to project</Link>
      <h1 className="text-2xl font-semibold">Edit {config.name}</h1>
    </header>
  );

  if (role !== "operator" && role !== "analyst") {
    return (
      <>
        {header}
        <p className="text-sm text-neutral-500">You have view-only access to this project, so you can&apos;t edit it.</p>
      </>
    );
  }

  const initial: ProjectFormValues = {
    workspaceId: "", newWorkspace: "",
    name: config.name,
    brandName: config.brandName,
    brandAliases: config.brandAliases.join("\n"),
    domains: config.domains.join("\n"),
    competitors: formatCompetitorLines(config.competitors),
    prompts: config.prompts.map((p) => p.text).join("\n"),
    budget: config.monthlyCreditBudget === null ? "" : String(config.monthlyCreditBudget),
    engines: config.engines,
    countries: config.markets,
  };

  return (
    <>
      {header}
      <p className="text-sm text-neutral-500">
        Past scans are kept. Prompts you remove are deactivated, not deleted.
      </p>
      <ProjectForm
        mode="edit"
        action={updateProjectAction.bind(null, config.id)}
        initial={initial}
        cancelHref={back}
        engines={engines}
        countries={countries}
      />
    </>
  );
}
