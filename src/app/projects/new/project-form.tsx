"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { uniqueLines } from "@/lib/lines";
import {
  estimateFromForm, formatCredits, formatDuration, readFormInputs, type ScanPricing,
} from "@/lib/scan-estimate";
import type { ProjectFormState, ProjectFormValues } from "../actions";

interface Props {
  action: (prev: ProjectFormState, fd: FormData) => Promise<ProjectFormState>;
  /** "edit" hides workspace choice and pre-fills from `initial`. */
  mode?: "create" | "edit";
  initial?: ProjectFormValues;
  cancelHref?: string;
  workspaces?: { id: string; name: string }[];
  canCreateWorkspace?: boolean;
  engines: { code: string; label: string }[];
  countries: { code: string; name: string; region: string }[];
  /** Per-engine prices and concurrency, for the live cost estimate. */
  pricing: ScanPricing;
}

const DEFAULT_ENGINES = ["chatgpt", "gemini", "perplexity"];
const DEFAULT_COUNTRIES = ["US"];

interface FormInputs {
  prompts: number;
  engines: string[];
  markets: number;
  budget: number | null;
}

/** What the form shows before the user touches anything. */
function initialInputs(v: ProjectFormValues | undefined, engines: Props["engines"], countries: Props["countries"]): FormInputs {
  if (v) {
    const budget = Number(v.budget);
    return {
      prompts: uniqueLines(v.prompts).length,
      engines: v.engines,
      markets: v.countries.length,
      budget: v.budget.trim() && Number.isFinite(budget) && budget >= 0 ? budget : null,
    };
  }
  return {
    prompts: 0,
    engines: DEFAULT_ENGINES.filter((e) => engines.some((x) => x.code === e)),
    markets: DEFAULT_COUNTRIES.filter((c) => countries.some((x) => x.code === c)).length,
    budget: null,
  };
}

const field = "w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent p-2 text-sm";

export function ProjectForm({
  action: submit, mode = "create", initial, cancelHref, workspaces = [], canCreateWorkspace = false, engines, countries, pricing,
}: Props) {
  const [state, action, pending] = useActionState<ProjectFormState, FormData>(submit, {});
  const v = state.values ?? initial;
  const editing = mode === "edit";
  const regions = [...new Set(countries.map((c) => c.region))];

  // Live estimate: re-read the form on every change so it follows what the user ticks and types.
  const [inputs, setInputs] = useState<FormInputs>(() => initialInputs(v, engines, countries));
  const estimate = estimateFromForm(pricing, inputs);

  return (
    <form
      action={action}
      onChange={(e) => setInputs(readFormInputs(new FormData(e.currentTarget)))}
      className="grid gap-4 sm:grid-cols-2"
    >
      {!editing && workspaces.length > 0 && (
        <label className="space-y-1 text-sm">
          Workspace
          <select name="workspaceId" className={field} defaultValue={v?.workspaceId ?? workspaces[0].id}>
            {canCreateWorkspace && <option value="">+ New workspace…</option>}
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </label>
      )}
      {!editing && canCreateWorkspace && (
        <label className="space-y-1 text-sm">
          {workspaces.length > 0 ? "New workspace name (only if “New workspace” is selected)" : "Workspace name (the client)"}
          <input name="newWorkspace" className={field} defaultValue={v?.newWorkspace} />
        </label>
      )}
      <label className="space-y-1 text-sm">Project name<input name="name" className={field} defaultValue={v?.name} required /></label>
      <label className="space-y-1 text-sm">Brand name<input name="brandName" className={field} defaultValue={v?.brandName} required /></label>
      <label className="space-y-1 text-sm">Brand aliases / misspellings (one per line)<textarea name="brandAliases" rows={3} className={field} defaultValue={v?.brandAliases} /></label>
      <label className="space-y-1 text-sm">Domains (one per line)<textarea name="domains" rows={3} className={field} defaultValue={v?.domains} placeholder="example.com" /></label>
      <label className="space-y-1 text-sm">
        Competitors (one per line)
        <textarea
          name="competitors"
          rows={5}
          className={`${field} font-mono`}
          defaultValue={v?.competitors}
          placeholder={"Midjourney\nIdeogram | ideogram.ai\nAdobe Firefly | firefly.adobe.com, adobe.com | Firefly"}
        />
        <span className="block text-xs text-neutral-500">
          Optional: <code>Name | domains | aliases</code>. Domains label cited sources as competitor.
        </span>
      </label>
      <label className="space-y-1 text-sm">Prompts (one per line)<textarea name="prompts" rows={4} className={field} defaultValue={v?.prompts} required /></label>

      <fieldset className="sm:col-span-2 space-y-2 text-sm">
        <legend className="font-medium">Engines</legend>
        <div className="flex flex-wrap gap-4">
          {engines.map((e) => (
            <label key={e.code} className="flex items-center gap-1">
              <input type="checkbox" name="engines" value={e.code} defaultChecked={v ? v.engines.includes(e.code) : DEFAULT_ENGINES.includes(e.code)} />
              {e.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="sm:col-span-2 space-y-2 text-sm">
        <legend className="font-medium">Markets</legend>
        {regions.map((region) => (
          <div key={region} className="flex flex-wrap items-center gap-4">
            <span className="w-20 text-xs text-neutral-500">{region}</span>
            {countries.filter((c) => c.region === region).map((c) => (
              <label key={c.code} className="flex items-center gap-1">
                <input type="checkbox" name="countries" value={c.code} defaultChecked={v ? v.countries.includes(c.code) : DEFAULT_COUNTRIES.includes(c.code)} />
                {c.name}
              </label>
            ))}
          </div>
        ))}
      </fieldset>

      <label className="space-y-1 text-sm">
        Monthly credit budget (optional)
        <input name="budget" inputMode="decimal" className={field} defaultValue={v?.budget} placeholder="e.g. 500" />
        <span className="block text-xs text-neutral-500">
          A scan costs about prompts × engines × markets × 1.25 credits. Leave blank for no limit.
        </span>
      </label>

      <section aria-live="polite" aria-label="Cost estimate" className="sm:col-span-2 rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800">
        <h2 className="mb-1 font-medium">Estimated cost of one scan</h2>
        {estimate.queries === 0 ? (
          <p className="text-neutral-500">Add prompts and select at least one engine and market to see an estimate.</p>
        ) : (
          <>
            <p>
              <strong>
                {estimate.queries} {estimate.queries === 1 ? "query" : "queries"}
              </strong>
              {" · "}
              {estimate.free ? "no credits used (mock provider)" : <strong>about {formatCredits(estimate.credits)} credits</strong>}
              {" · "}
              {formatDuration(estimate.seconds)}
              {pricing.concurrency > 1 ? ` (${pricing.concurrency} at a time)` : ""}
            </p>
            {!estimate.free && (
              <p className="text-xs text-neutral-500">
                {estimate.byEngine.map((e) => `${e.engine} ${e.queries} × ${formatCredits(pricing.prices[e.engine])} = ${formatCredits(e.credits)}`).join(" · ")}
              </p>
            )}
            {!estimate.free && inputs.budget !== null && estimate.credits > inputs.budget && (
              <p role="alert" className="mt-1 font-medium text-red-600">
                Your monthly budget ({formatCredits(inputs.budget)}) is lower than one full scan ({formatCredits(estimate.credits)}), so
                scans would be refused.
              </p>
            )}
          </>
        )}
      </section>

      <div className="sm:col-span-2 space-y-2">
        <button type="submit" disabled={pending} className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black">
          {pending ? (editing ? "Saving…" : "Creating…") : editing ? "Save changes" : "Create project"}
        </button>
        {cancelHref && (
          <Link href={cancelHref} className="ml-3 text-sm underline">
            Cancel
          </Link>
        )}
        {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      </div>
    </form>
  );
}
