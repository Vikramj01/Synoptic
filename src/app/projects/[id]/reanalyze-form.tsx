"use client";

import { useActionState } from "react";
import { reanalyzeAction, type ReanalyzeState } from "../actions";

export function ReanalyzeForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<ReanalyzeState>(() => reanalyzeAction(projectId), {});
  return (
    <form action={action} className="space-y-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-neutral-400 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:hover:bg-neutral-800"
      >
        {pending ? "Re-analyzing…" : "Re-analyze saved answers (free)"}
      </button>
      <p className="text-xs text-neutral-500">
        Recomputes mentions, ranks and source labels for every saved answer using the project&apos;s current brand,
        aliases, domains and competitors. Uses no credits.
      </p>
      {state.message && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {state.message}
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
