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
            <tr className="border-b">
              <th className="py-2">Prompt</th><th>Engine</th><th>Market</th><th>Mentioned</th><th>Rank</th><th>Cited</th><th>Competitors</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className="border-b align-top">
                <td className="py-2 pr-2">{r.prompt}</td>
                <td className="pr-2">{r.engine}</td>
                <td className="pr-2">{r.country}</td>
                <td className="pr-2">{r.error ? <span className="text-red-600">{r.error}</span> : r.brandMentioned ? "Yes" : "No"}</td>
                <td className="pr-2">{r.mentionRank ?? "–"}</td>
                <td className="pr-2">{r.domainCited ? "Yes" : "No"}</td>
                <td>{r.competitorsMentioned.join(", ") || "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
