import "server-only";
import { queryingBaseUrl } from "./providers/queryingai";

export interface QueryingBalance {
  /** Credits spendable now (tasks already submitted have their price held and are excluded). */
  remaining: number;
  plan: string | null;
}

/**
 * Reads the account's live credit balance from querying.ai (GET /v1/credits;
 * read-only, costs nothing). Best effort: returns null if the provider is not
 * querying.ai, there is no key, or the call is slow, refused or malformed, so
 * the page can still show an estimate without it. Never throws.
 */
export async function getQueryingBalance(
  opts: { provider?: string; apiKey?: string; baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<QueryingBalance | null> {
  const provider = opts.provider ?? process.env.PROVIDER;
  const apiKey = opts.apiKey ?? process.env.QUERYING_API_KEY;
  if (provider !== "queryingai" || !apiKey) return null;

  try {
    const res = await (opts.fetchImpl ?? fetch)(`${queryingBaseUrl(opts.baseUrl)}/v1/credits`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 3000),
    });
    if (!res.ok) {
      console.warn(`querying.ai balance lookup returned HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { success?: boolean; remaining?: unknown; plan?: unknown };
    if (body.success === false || typeof body.remaining !== "number" || !Number.isFinite(body.remaining)) return null;
    return { remaining: body.remaining, plan: typeof body.plan === "string" ? body.plan : null };
  } catch (e) {
    console.warn("querying.ai balance lookup failed:", e instanceof Error ? e.name : "error");
    return null;
  }
}
