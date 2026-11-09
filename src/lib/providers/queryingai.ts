import type { EngineProvider } from "./types";

/**
 * Adapter for the querying.ai API (https://querying.ai/en).
 *
 * TODO: the API docs were not reachable when this was scaffolded, so the
 * request/response mapping is NOT implemented yet. Fill in `query` once the
 * endpoint, auth scheme and response shape are confirmed.
 * Config: QUERYINGAI_API_KEY, QUERYINGAI_BASE_URL.
 */
export function createQueryingAiProvider(): EngineProvider {
  const apiKey = process.env.QUERYINGAI_API_KEY;
  const baseUrl = process.env.QUERYINGAI_BASE_URL;
  return {
    async query() {
      if (!apiKey || !baseUrl) {
        throw new Error("QUERYINGAI_API_KEY and QUERYINGAI_BASE_URL must be set");
      }
      throw new Error("querying.ai adapter not implemented yet (see src/lib/providers/queryingai.ts)");
    },
  };
}
