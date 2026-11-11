import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getProjectConfig } from "@/lib/projects";
import { listScanRuns } from "@/lib/scans";
import {
  formatByEngine, parseSourceFilters, percent, safeHref, sourcesHref, type SourceFilters, type SourceKind,
} from "@/lib/source-filters";
import { getSourceStats, getSourceSummary, type SourceRow } from "@/lib/sources";
import { Stat } from "@/components/scan-results";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Params = Record<string, string | string[] | undefined>;

export default function SourcesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Params> }) {
  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6">
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading sources…</p>}>
        <SourcesView params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function SourcesView({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Params> }) {
  const { id } = await params;
  const query = await searchParams;
  if (!UUID.test(id)) notFound();
  await requireUser();

  const config = await getProjectConfig(id);
  if (!config) notFound();

  const filters = parseSourceFilters(query, config.engines);
  const runs = await listScanRuns(id, 1);
  const latest = runs[0] ?? null;
  const back = `/projects/${config.id}`;

  const header = (
    <header className="space-y-1">
      <Link href={back} className="text-xs text-neutral-500 underline">← Back to {config.name}</Link>
      <h1 className="text-2xl font-semibold">Top cited sources</h1>
    </header>
  );

  if (!latest) {
    return (
      <>
        {header}
        <p className="text-sm text-neutral-500">No scans yet. Run a scan to see which sources the AI engines cite.</p>
      </>
    );
  }

  const scope = {
    scanRunId: filters.scope === "latest" ? latest.id : null,
    engine: filters.engine,
  };
  const [summary, rows, clientPages] = await Promise.all([
    getSourceSummary(id, scope),
    getSourceStats(id, { ...scope, role: filters.role, by: filters.by, limit: 25 }),
    getSourceStats(id, { ...scope, role: "client", by: "url", limit: 10 }),
  ]);

  const scopeLabel =
    filters.scope === "latest"
      ? `Latest scan (${new Date(latest.createdAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC)`
      : "All saved scans";

  return (
    <>
      {header}
      <p className="text-sm text-neutral-500">
        {scopeLabel}
        {filters.engine ? ` · ${filters.engine} only` : ""}
      </p>

      <FilterBar projectId={config.id} filters={filters} engines={config.engines} />

      <section className="grid grid-cols-2 gap-6 sm:grid-cols-3">
        <Stat label="Answers analysed" value={String(summary.answers)} />
        <Stat label="Citations" value={String(summary.citations)} />
        <Stat label="Distinct domains" value={String(summary.domains)} />
        <Stat
          label={`Answers citing your domain (${summary.answersCitingClient} of ${summary.answers})`}
          value={`${percent(summary.answersCitingClient, summary.answers)}%`}
        />
        <Stat label="Your share of citations" value={`${percent(summary.clientCitations, summary.citations)}%`} />
        <Stat label="Competitor share of citations" value={`${percent(summary.competitorCitations, summary.citations)}%`} />
      </section>

      {summary.citations === 0 ? (
        <p className="text-sm text-neutral-500">
          No cited sources in this selection.{filters.engine || filters.role ? " Try clearing a filter." : ""}
        </p>
      ) : (
        <>
          <SourceTable rows={rows} by={filters.by} answers={summary.answers} engines={config.engines} />
          <section className="space-y-2">
            <h2 className="text-sm font-medium">Your pages that were cited</h2>
            {clientPages.length === 0 ? (
              <p className="text-sm text-neutral-500">None of your pages were cited in this selection.</p>
            ) : (
              <SourceTable rows={clientPages} by="url" answers={summary.answers} engines={config.engines} compact />
            )}
          </section>
        </>
      )}
    </>
  );
}

function FilterBar({ projectId, filters, engines }: { projectId: string; filters: SourceFilters; engines: string[] }) {
  const groups: { label: string; options: { label: string; active: boolean; filters: SourceFilters }[] }[] = [
    {
      label: "Scans",
      options: [
        { label: "Latest scan", active: filters.scope === "latest", filters: { ...filters, scope: "latest" } },
        { label: "All scans", active: filters.scope === "all", filters: { ...filters, scope: "all" } },
      ],
    },
    {
      label: "Engine",
      options: [
        { label: "All", active: filters.engine === null, filters: { ...filters, engine: null } },
        ...engines.map((e) => ({ label: e, active: filters.engine === e, filters: { ...filters, engine: e } })),
      ],
    },
    {
      label: "Type",
      options: [
        { label: "All", active: filters.role === null, filters: { ...filters, role: null } },
        { label: "Yours", active: filters.role === "client", filters: { ...filters, role: "client" as const } },
        { label: "Competitors", active: filters.role === "competitor", filters: { ...filters, role: "competitor" as const } },
        { label: "Other", active: filters.role === "other", filters: { ...filters, role: "other" as const } },
      ],
    },
    {
      label: "Group by",
      options: [
        { label: "Domains", active: filters.by === "domain", filters: { ...filters, by: "domain" as const } },
        { label: "Pages", active: filters.by === "url", filters: { ...filters, by: "url" as const } },
      ],
    },
  ];

  return (
    <nav aria-label="Filters" className="space-y-2">
      {groups.map((g) => (
        <div key={g.label} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="w-16 text-neutral-500">{g.label}</span>
          {g.options.map((o) => (
            <Link
              key={o.label}
              href={sourcesHref(projectId, o.filters)}
              aria-current={o.active ? "true" : undefined}
              className={`rounded border px-2 py-1 ${o.active ? "border-black font-medium dark:border-white" : "border-neutral-300 dark:border-neutral-700"}`}
            >
              {o.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

const BADGE: Record<SourceKind, { label: string; className: string }> = {
  client: { label: "Yours", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100" },
  competitor: { label: "Competitor", className: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100" },
  other: { label: "Other", className: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200" },
};

function SourceTable({
  rows, by, answers, engines, compact = false,
}: { rows: SourceRow[]; by: "domain" | "url"; answers: number; engines: string[]; compact?: boolean }) {
  const showEngines = engines.length > 1 && !compact;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b text-xs font-medium text-neutral-500">
            <th className="py-2 pr-4 font-medium">#</th>
            <th className="py-2 pr-4 font-medium">{by === "url" ? "Page" : "Domain"}</th>
            <th className="py-2 pr-4 font-medium">Type</th>
            <th className="py-2 pr-4 font-medium">Citations</th>
            <th className="py-2 pr-4 font-medium">In answers</th>
            {showEngines && <th className="py-2 font-medium">By engine</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const href = safeHref(by === "url" ? r.item : `https://${r.item}`);
            const badge = BADGE[r.kind];
            return (
              <tr key={r.item} className="border-b align-top">
                <td className="py-2 pr-4 text-neutral-500">{i + 1}</td>
                <td className="max-w-md break-all py-2 pr-4">
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                      {r.item}
                    </a>
                  ) : (
                    r.item
                  )}
                </td>
                <td className="py-2 pr-4">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${badge.className}`}>{badge.label}</span>
                </td>
                <td className="py-2 pr-4">{r.citations}</td>
                <td className="py-2 pr-4">
                  {r.answers} <span className="text-neutral-500">({percent(r.answers, answers)}%)</span>
                </td>
                {showEngines && <td className="py-2 text-neutral-500">{formatByEngine(r.byEngine)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
