export type Engine = "chatgpt" | "gemini" | "perplexity" | "claude" | "copilot" | "google_ai_overviews";

export const ENGINES: Engine[] = ["chatgpt", "gemini", "perplexity", "claude", "copilot", "google_ai_overviews"];

export interface Citation {
  url: string;
  title?: string;
}

/** Raw answer returned by an engine provider. */
export interface EngineAnswer {
  answer: string;
  citations: Citation[];
}

export interface ScanInput {
  domain: string; // e.g. "example.com"
  brand: string; // e.g. "Example"
  competitors: string[]; // brand names
  prompts: string[];
  engines: Engine[];
}

export interface PromptResult {
  prompt: string;
  engine: Engine;
  answer: string;
  citations: Citation[];
  brandMentioned: boolean;
  /** 1-based rank of brand among all tracked brands by first mention; null if absent. */
  mentionRank: number | null;
  domainCited: boolean;
  competitorsMentioned: string[];
  error?: string;
}

export interface Scan {
  id: string;
  createdAt: string;
  input: ScanInput;
  results: PromptResult[];
  summary: ScanSummary;
}

export interface ScanSummary {
  total: number;
  mentionRate: number; // 0..1
  citationRate: number; // 0..1
  byEngine: Record<string, { total: number; mentionRate: number; citationRate: number }>;
}
