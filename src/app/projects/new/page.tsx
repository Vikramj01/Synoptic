import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getOperatorAgencyId, listCountries, listEngines, listWorkspaces } from "@/lib/projects";
import { scanPricing } from "@/lib/scan-estimate";
import { createProjectAction } from "../actions";
import { ProjectForm } from "./project-form";

export default function NewProjectPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <Link href="/" className="text-xs text-neutral-500 underline">← All projects</Link>
        <h1 className="text-2xl font-semibold">New project</h1>
      </header>
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <Form />
      </Suspense>
    </main>
  );
}

async function Form() {
  const user = await requireUser();
  const [workspaces, agencyId, engines, countries] = await Promise.all([
    listWorkspaces(), getOperatorAgencyId(user.id), listEngines(), listCountries(),
  ]);
  const canCreateWorkspace = agencyId !== null;

  if (workspaces.length === 0 && !canCreateWorkspace) {
    return <p className="text-sm text-neutral-500">You haven&apos;t been given access to a workspace yet. Ask an operator to add you.</p>;
  }
  return <ProjectForm action={createProjectAction} pricing={scanPricing()} workspaces={workspaces} canCreateWorkspace={canCreateWorkspace} engines={engines} countries={countries} />;
}
