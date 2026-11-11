"use client";

import { useActionState } from "react";
import Link from "next/link";
import { runScanAction, type RunScanState } from "../actions";
import { formatCredits } from "@/lib/scan-estimate";

export function RunScanForm({
  projectId, queries, credits, free, blocked, editHref,
}: { projectId: string; queries: number; credits: number; free: boolean; blocked: boolean; editHref: string }) {
  const [state, action, pending] = useActionState<RunScanState>(() => runScanAction(projectId), {});
  const cost = free ? "" : ` · about ${formatCredits(credits)} credits`;
  return (
    <form action={action} className="space-y-2">
      <button
        type="submit"
        disabled={pending || blocked}
        className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "Scanning… (this can take a while)" : `Run scan (${queries} ${queries === 1 ? "query" : "queries"}${cost})`}
      </button>
      {blocked && !pending && (
        <p className="text-xs text-neutral-500">
          This scan can&apos;t run as set up.{" "}
          <Link href={editHref} className="underline">
            Edit project
          </Link>{" "}
          to change the budget, prompts, engines or markets.
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
          {/budget/i.test(state.error) && (
            <>
              {" "}
              <Link href={editHref} className="underline">
                Edit project
              </Link>
            </>
          )}
        </p>
      )}
    </form>
  );
}
