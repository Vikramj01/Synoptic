import { describe, expect, it } from "vitest";
import { analyzeAnswer, citationMatchesDomain, normalizeDomain } from "./analysis";
import type { ScanInput } from "./types";

const input: ScanInput = {
  domain: "https://www.example.com/",
  brand: "Example",
  competitors: ["Acme", "Globex"],
  prompts: [],
  engines: ["chatgpt"],
};

describe("analysis", () => {
  it("normalizes domains", () => expect(normalizeDomain("https://www.Example.com/x")).toBe("example.com"));
  it("matches subdomains but not lookalikes", () => {
    expect(citationMatchesDomain("https://blog.example.com/a", "example.com")).toBe(true);
    expect(citationMatchesDomain("https://notexample.com/a", "example.com")).toBe(false);
  });
  it("ranks brand among competitors by first mention", () => {
    const r = analyzeAnswer(input, "p", "chatgpt", {
      answer: "Try Acme, then Example, then Globex.",
      citations: [{ url: "https://example.com/" }],
    });
    expect(r.brandMentioned).toBe(true);
    expect(r.mentionRank).toBe(2);
    expect(r.domainCited).toBe(true);
    expect(r.competitorsMentioned).toEqual(["Acme", "Globex"]);
  });
  it("reports absence", () => {
    const r = analyzeAnswer(input, "p", "chatgpt", { answer: "Only Acme.", citations: [] });
    expect(r.brandMentioned).toBe(false);
    expect(r.mentionRank).toBeNull();
  });
});
