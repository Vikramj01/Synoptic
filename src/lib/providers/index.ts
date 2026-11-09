import { mockProvider } from "./mock";
import { createQueryingAiProvider } from "./queryingai";
import type { EngineProvider } from "./types";

export function getProvider(): EngineProvider {
  return process.env.PROVIDER === "queryingai" ? createQueryingAiProvider() : mockProvider;
}
