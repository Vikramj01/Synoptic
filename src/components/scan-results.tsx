import type { PromptResult, ScanSummary } from "@/lib/types";

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-3xl font-semibold">{value}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}

export function ScanResults({ summary, results }: { summary: ScanSummary; results: PromptResult[] }) {
  return (
    <section className="space-y-4">
      <div className="flex gap-6">
        <Stat label="Mention rate" value={pct(summary.mentionRate)} />
        <Stat label="Citation rate" value={pct(summary.citationRate)} />
        <Stat label="Answers" value={String(summary.total)} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b text-xs font-medium text-neutral-500">
              {["Prompt", "Engine", "Market", "Mentioned", "Rank", "Cited", "Competitors"].map((h) => (
                <th key={h} className="py-2 pr-4 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className="border-b align-top">
                <td className="py-2 pr-4">{r.prompt}</td>
                <td className="pr-4">{r.engine}</td>
                <td className="pr-4">{r.country}</td>
                <td className="pr-4">{r.error ? <span className="text-red-600">{r.error}</span> : r.brandMentioned ? "Yes" : "No"}</td>
                <td className="pr-4">{r.mentionRank ?? "–"}</td>
                <td className="pr-4">{r.domainCited ? "Yes" : "No"}</td>
                <td>{r.competitorsMentioned.join(", ") || "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
