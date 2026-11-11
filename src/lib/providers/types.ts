import type { Engine, EngineAnswer } from "../types";

export interface QueryOptions {
  /**
   * Identifies this unit of work, so a retried submit never creates (or pays for)
   * a second task. Built from the work, not the attempt.
   */
  idempotencyKey?: string;
}

/** Anything that can answer a prompt as a given AI engine. */
export interface EngineProvider {
  /** `country` is an ISO 3166-1 alpha-2 market; providers fall back to their default when omitted. */
  query(prompt: string, engine: Engine, country?: string, opts?: QueryOptions): Promise<EngineAnswer>;
}
