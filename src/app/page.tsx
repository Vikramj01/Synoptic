"use client";
import { useState } from "react";
import { ENGINES, type Engine, type Scan } from "@/lib/types";

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function Home() {
  const [domain, setDomain] = useState("example.com");
  const [brand, setBrand] = useState("Example");
  const [competitors, setCompetitors] = useState("Acme\nGlobex");
  const [prompts, setPrompts] = useState("best tools for X\nalternatives to Acme");
  const [engines, setEngines] = useState<Engine[]>(["chatgpt", "gemini", "perplexity"]);
  const [scan, setScan] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/scans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain, brand, competitors: lines(competitors), prompts: lines(prompts), engines }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? "Scan failed");
    else setScan(data);
    setBusy(false);
  }

  const field = "w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent p-2 text-sm";

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Synoptic</h1>
        <p className="text-sm text-neutral-500">AI visibility (GEO) monitoring across AI engines.</p>
      </header>

      <form onSubmit={run} className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm">Domain<input className={field} value={domain} onChange={(e) => setDomain(e.target.value)} /></label>
        <label className="space-y-1 text-sm">Brand name<input className={field} value={brand} onChange={(e) => setBrand(e.target.value)} /></label>
        <label className="space-y-1 text-sm">Prompts (one per line)<textarea rows={4} className={field} value={prompts} onChange={(e) => setPrompts(e.target.value)} /></label>
        <label className="space-y-1 text-sm">Competitors (one per line)<textarea rows={4} className={field} value={competitors} onChange={(e) => setCompetitors(e.target.value)} /></label>
        <fieldset className="sm:col-span-2 flex flex-wrap gap-4 text-sm">
          {ENGINES.map((en) => (
            <label key={en} className="flex items-center gap-1">
              <input type="checkbox" checked={engines.includes(en)}
                onChange={(e) => setEngines(e.target.checked ? [...engines, en] : engines.filter((x) => x !== en))} />
              {en}
            </label>
          ))}
        </fieldset>
        <button disabled={busy} className="sm:col-span-2 rounded bg-black px-4 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-black">
          {busy ? "Scanning…" : "Run scan"}
        </button>
        {error && <p className="sm:col-span-2 text-sm text-red-600">{error}</p>}
      </form>

      {scan && (
        <section className="space-y-4">
          <div className="flex gap-6">
            <Stat label="Mention rate" value={pct(scan.summary.mentionRate)} />
            <Stat label="Citation rate" value={pct(scan.summary.citationRate)} />
            <Stat label="Answers" value={String(scan.summary.total)} />
          </div>
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b"><th className="py-2">Prompt</th><th>Engine</th><th>Mentioned</th><th>Rank</th><th>Cited</th><th>Competitors</th></tr></thead>
            <tbody>
              {scan.results.map((r, i) => (
                <tr key={i} className="border-b align-top">
                  <td className="py-2 pr-2">{r.prompt}</td>
                  <td>{r.engine}</td>
                  <td>{r.error ? <span className="text-red-600">{r.error}</span> : r.brandMentioned ? "Yes" : "No"}</td>
                  <td>{r.mentionRank ?? "–"}</td>
                  <td>{r.domainCited ? "Yes" : "No"}</td>
                  <td>{r.competitorsMentioned.join(", ") || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-3xl font-semibold">{value}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}
