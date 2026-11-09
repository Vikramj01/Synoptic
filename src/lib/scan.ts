import { randomUUID } from "crypto";
import { analyzeAnswer, summarize } from "./analysis";
import { getProvider } from "./providers";
import type { PromptResult, Scan, ScanInput } from "./types";

export async function runScan(input: ScanInput): Promise<Scan> {
  const provider = getProvider();
  const jobs = input.prompts.flatMap((prompt) => input.engines.map((engine) => ({ prompt, engine })));

  const results: PromptResult[] = await Promise.all(
    jobs.map(async ({ prompt, engine }) => {
      try {
        return analyzeAnswer(input, prompt, engine, await provider.query(prompt, engine));
      } catch (e) {
        return {
          prompt, engine, answer: "", citations: [], brandMentioned: false, mentionRank: null,
          domainCited: false, competitorsMentioned: [], error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );

  return { id: randomUUID(), createdAt: new Date().toISOString(), input, results, summary: summarize(results) };
}
