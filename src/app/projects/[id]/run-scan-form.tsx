"use client";

import { useActionState } from "react";
import { runScanAction, type RunScanState } from "../actions";

export function RunScanForm({ projectId, tasks }: { projectId: string; tasks: number }) {
  const [state, action, pending] = useActionState<RunScanState>(() => runScanAction(projectId), {});
  return (
    <form action={action} className="space-y-2">
      <button
        type="submit"
        disabled={pending || tasks === 0}
        className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "Scanning… (this can take a while)" : `Run scan (${tasks} ${tasks === 1 ? "query" : "queries"})`}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
