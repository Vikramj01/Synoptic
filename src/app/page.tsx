import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listProjects } from "@/lib/projects";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Synoptic</h1>
          <p className="text-sm text-neutral-500">AI visibility (GEO) monitoring across AI engines.</p>
        </div>
        <Link href="/projects/new" className="rounded bg-black px-4 py-2 text-sm text-white dark:bg-white dark:text-black">
          New project
        </Link>
      </header>
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading projects…</p>}>
        <Projects />
      </Suspense>
    </main>
  );
}

async function Projects() {
  await requireUser();
  const projects = await listProjects();
  if (projects.length === 0) {
    return <p className="text-sm text-neutral-500">No projects yet. Create one to start monitoring a brand.</p>;
  }
  const byWorkspace = Map.groupBy(projects, (p) => p.workspaceName);
  return (
    <div className="space-y-6">
      {[...byWorkspace].map(([workspace, items]) => (
        <section key={workspace} className="space-y-2">
          <h2 className="text-sm font-medium text-neutral-500">{workspace}</h2>
          <ul className="divide-y rounded border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {items.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="flex justify-between p-3 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900">
                  <span>{p.name}</span>
                  <span className="text-neutral-500">{p.brandName}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
