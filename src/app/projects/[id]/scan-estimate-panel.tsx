import type { BudgetStatus } from "@/lib/scan-plan";
import { formatCredits, formatDuration, type ScanEstimate, type ScanEvaluation, type ScanPricing } from "@/lib/scan-estimate";
import type { QueryingBalance } from "@/lib/querying-account";

/** What a scan will cost and take, and why it might not be allowed to run. Server-rendered, no JS. */
export function ScanEstimatePanel({
  estimate, pricing, evaluation, budgets, balance,
}: {
  estimate: ScanEstimate;
  pricing: ScanPricing;
  evaluation: ScanEvaluation;
  budgets: (BudgetStatus | null)[];
  balance: QueryingBalance | null;
}) {
  const { free, queries, credits, seconds, byEngine } = estimate;
  const activeBudgets = budgets.filter((b): b is BudgetStatus => b !== null);

  return (
    <section aria-label="Scan estimate" className="space-y-3 rounded border border-neutral-200 p-4 text-sm dark:border-neutral-800">
      <h2 className="font-medium">Estimate for this scan</h2>

      <p>
        <strong>
          {queries} {queries === 1 ? "query" : "queries"}
        </strong>
        {" · "}
        {free ? (
          <span>no credits used (mock provider)</span>
        ) : (
          <strong>about {formatCredits(credits)} credits</strong>
        )}
        {queries > 0 && (
          <>
            {" · "}
            {formatDuration(seconds)}
            {pricing.concurrency > 1 ? ` (${pricing.concurrency} at a time)` : ""}
          </>
        )}
      </p>

      {!free && byEngine.length > 0 && (
        <table className="w-full max-w-md text-left text-xs">
          <thead>
            <tr className="border-b text-neutral-500">
              <th className="py-1 pr-4 font-medium">Engine</th>
              <th className="py-1 pr-4 font-medium">Queries</th>
              <th className="py-1 pr-4 font-medium">Credits each</th>
              <th className="py-1 font-medium">Credits</th>
            </tr>
          </thead>
          <tbody>
            {byEngine.map((e) => (
              <tr key={e.engine} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-1 pr-4">{e.engine}</td>
                <td className="py-1 pr-4">{e.queries}</td>
                <td className="py-1 pr-4">{formatCredits(pricing.prices[e.engine])}</td>
                <td className="py-1">{formatCredits(e.credits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!free && (
        <ul className="space-y-1">
          {activeBudgets.map((b) => (
            <li key={b.label}>
              {b.label} budget: {formatCredits(b.committed)} used this month + {formatCredits(b.estimate)} for this scan ={" "}
              <strong>{formatCredits(b.after)}</strong> of {formatCredits(b.budget)}{" "}
              {b.exceeded ? (
                <span className="font-medium text-red-600">(over budget)</span>
              ) : (
                <span className="text-neutral-500">({formatCredits(b.budget - b.after)} left after this scan)</span>
              )}
            </li>
          ))}
          {activeBudgets.length === 0 && <li className="text-neutral-500">No monthly budget set for this project or workspace.</li>}
          <li>
            {balance ? (
              <>
                querying.ai balance: <strong>{formatCredits(balance.remaining)} credits</strong>
                {balance.plan ? ` (${balance.plan} plan)` : ""} → about{" "}
                {formatCredits(Math.max(0, Math.round((balance.remaining - credits) * 100) / 100))} after this scan
              </>
            ) : (
              <span className="text-neutral-500">querying.ai balance unavailable right now.</span>
            )}
          </li>
        </ul>
      )}

      {evaluation.blockers.map((b) => (
        <p key={b} role="alert" className="font-medium text-red-600">
          {b}
        </p>
      ))}
      {evaluation.warnings.map((w) => (
        <p key={w} role="status" className="text-amber-700 dark:text-amber-400">
          {w}
        </p>
      ))}
    </section>
  );
}
