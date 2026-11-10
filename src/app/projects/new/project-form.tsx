"use client";

import { useActionState } from "react";
import { createProjectAction, type ProjectFormState } from "../actions";

interface Props {
  workspaces: { id: string; name: string }[];
  canCreateWorkspace: boolean;
  engines: { code: string; label: string }[];
  countries: { code: string; name: string; region: string }[];
}

const field = "w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent p-2 text-sm";

export function ProjectForm({ workspaces, canCreateWorkspace, engines, countries }: Props) {
  const [state, action, pending] = useActionState<ProjectFormState, FormData>(createProjectAction, {});
  const v = state.values;
  const regions = [...new Set(countries.map((c) => c.region))];

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      {workspaces.length > 0 && (
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
      {canCreateWorkspace && (
        <label className="space-y-1 text-sm">
          {workspaces.length > 0 ? "New workspace name (only if “New workspace” is selected)" : "Workspace name (the client)"}
          <input name="newWorkspace" className={field} defaultValue={v?.newWorkspace} />
        </label>
      )}
      <label className="space-y-1 text-sm">Project name<input name="name" className={field} defaultValue={v?.name} required /></label>
      <label className="space-y-1 text-sm">Brand name<input name="brandName" className={field} defaultValue={v?.brandName} required /></label>
      <label className="space-y-1 text-sm">Brand aliases / misspellings (one per line)<textarea name="brandAliases" rows={3} className={field} defaultValue={v?.brandAliases} /></label>
      <label className="space-y-1 text-sm">Domains (one per line)<textarea name="domains" rows={3} className={field} defaultValue={v?.domains} placeholder="example.com" /></label>
      <label className="space-y-1 text-sm">Competitors (one per line)<textarea name="competitors" rows={4} className={field} defaultValue={v?.competitors} /></label>
      <label className="space-y-1 text-sm">Prompts (one per line)<textarea name="prompts" rows={4} className={field} defaultValue={v?.prompts} required /></label>

      <fieldset className="sm:col-span-2 space-y-2 text-sm">
        <legend className="font-medium">Engines</legend>
        <div className="flex flex-wrap gap-4">
          {engines.map((e) => (
            <label key={e.code} className="flex items-center gap-1">
              <input type="checkbox" name="engines" value={e.code} defaultChecked={v ? v.engines.includes(e.code) : ["chatgpt", "gemini", "perplexity"].includes(e.code)} />
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
                <input type="checkbox" name="countries" value={c.code} defaultChecked={v ? v.countries.includes(c.code) : c.code === "US"} />
                {c.name}
              </label>
            ))}
          </div>
        ))}
      </fieldset>

      <label className="space-y-1 text-sm">
        Monthly credit budget (optional)
        <input name="budget" inputMode="decimal" className={field} defaultValue={v?.budget} placeholder="e.g. 500" />
      </label>

      <div className="sm:col-span-2 space-y-2">
        <button type="submit" disabled={pending} className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black">
          {pending ? "Creating…" : "Create project"}
        </button>
        {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      </div>
    </form>
  );
}
