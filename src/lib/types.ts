export type Engine =
  | "chatgpt"
  | "gemini"
  | "perplexity"
  | "copilot"
  | "google_ai_overviews"
  | "google_ai_mode"
  | "meta_ai";

export const ENGINES: Engine[] = [
  "chatgpt",
  "gemini",
  "perplexity",
  "copilot",
  "google_ai_overviews",
  "google_ai_mode",
  "meta_ai",
];

export interface Citation {
  url: string;
  title?: string;
}

/** Raw answer returned by an engine provider. */
export interface EngineAnswer {
  answer: string;
  citations: Citation[];
}

/** Analysis of one answer against a project's brand, domains and competitors. */
export interface AnswerAnalysis {
  brandMentioned: boolean;
  /** 1-based rank of brand among all tracked brands by first mention; null if absent. */
  mentionRank: number | null;
  domainCited: boolean;
  competitorsMentioned: string[];
}

export interface PromptResult extends AnswerAnalysis {
  prompt: string;
  engine: Engine;
  /** ISO 3166-1 alpha-2 market the prompt was run in. */
  country: string;
  answer: string;
  citations: Citation[];
  error?: string;
}

export interface ScanSummary {
  total: number;
  mentionRate: number; // 0..1
  citationRate: number; // 0..1
  byEngine: Record<string, { total: number; mentionRate: number; citationRate: number }>;
}
