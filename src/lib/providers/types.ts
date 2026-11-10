import type { Engine, EngineAnswer } from "../types";

/** Anything that can answer a prompt as a given AI engine. */
export interface EngineProvider {
  /** `country` is an ISO 3166-1 alpha-2 market; providers fall back to their default when omitted. */
  query(prompt: string, engine: Engine, country?: string): Promise<EngineAnswer>;
}
