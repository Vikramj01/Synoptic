import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getProjectConfig, getWorkspaceRole } from "@/lib/projects";
import { buildJobs } from "@/lib/scan-plan";
import { getMonthUsage, getScanDetail, listScanRuns } from "@/lib/scans";
import { ScanResults } from "@/components/scan-results";
import { RunScanForm } from "./run-scan-form";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ProjectPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6">
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading project…</p>}>
        <ProjectView params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function ProjectView({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ run?: string }> }) {
  const { id } = await params;
  const { run } = await searchParams;
  if (!UUID.test(id)) notFound();
  await requireUser();

  const config = await getProjectConfig(id);
  if (!config) notFound();

  const [role, runs, usage] = await Promise.all([getWorkspaceRole(config.workspaceId), listScanRuns(id), getMonthUsage(id)]);
  const canRun = role === "operator" || role === "analyst";
  const selectedId = run && UUID.test(run) ? run : runs[0]?.id;
  const detail = selectedId ? await getScanDetail(id, selectedId) : null;
  const tasks = buildJobs(config).length;

  return (
    <>
      <header className="space-y-1">
        <Link href="/" className="text-xs text-neutral-500 underline">← All projects</Link>
        <h1 className="text-2xl font-semibold">{config.name}</h1>
        <p className="text-sm text-neutral-500">
          {config.brandName} · {config.domains.join(", ")}
        </p>
      </header>

      <section className="grid gap-4 text-sm sm:grid-cols-2">
        <Info label="Engines" value={config.engines.join(", ")} />
        <Info label="Markets" value={config.markets.join(", ")} />
        <Info label="Prompts" value={`${config.prompts.length} active`} />
        <Info label="Competitors" value={config.competitors.map((c) => c.name).join(", ") || "–"} />
        <Info
          label="Credits this month"
          value={`${usage.toFixed(2)}${config.monthlyCreditBudget === null ? "" : ` of ${config.monthlyCreditBudget} budget`}`}
        />
        <Info label="Your role" value={role ?? "–"} />
      </section>

      {canRun ? (
        <RunScanForm projectId={config.id} tasks={tasks} />
      ) : (
        <p className="text-sm text-neutral-500">You have view-only access to this project.</p>
      )}

      {runs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Scan history</h2>
          <ul className="flex flex-wrap gap-2 text-xs">
            {runs.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/projects/${config.id}?run=${r.id}`}
                  className={`rounded border px-2 py-1 ${r.id === selectedId ? "border-black dark:border-white" : "border-neutral-300 dark:border-neutral-700"}`}
                >
                  {new Date(r.createdAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC · {r.status}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail ? (
        <ScanResults summary={detail.summary} results={detail.results} />
      ) : (
        runs.length === 0 && <p className="text-sm text-neutral-500">No scans yet. Run the first one above.</p>
      )}
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-neutral-500">{label}</div>
      <div>{value}</div>
    </div>
  );
}
