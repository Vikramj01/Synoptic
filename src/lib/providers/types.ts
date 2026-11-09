import type { Engine, EngineAnswer } from "../types";

/** Anything that can answer a prompt as a given AI engine. */
export interface EngineProvider {
  query(prompt: string, engine: Engine): Promise<EngineAnswer>;
}
