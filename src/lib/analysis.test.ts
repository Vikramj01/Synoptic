import { describe, expect, it } from "vitest";
import { analyze, citationMatchesDomain, classifySource, normalizeDomain, summarize, type AnalysisTarget } from "./analysis";

const target: AnalysisTarget = {
  brand: "Example",
  aliases: ["Exampel"],
  domains: ["https://www.example.com/", "shop.example.ae"],
  competitors: [
    { name: "Acme", domains: ["acme.com"] },
    { name: "Globex" },
  ],
};

describe("domains", () => {
  it("normalizes", () => expect(normalizeDomain("https://www.Example.com/x")).toBe("example.com"));
  it("matches subdomains but not lookalikes", () => {
    expect(citationMatchesDomain("https://blog.example.com/a", "example.com")).toBe(true);
    expect(citationMatchesDomain("https://notexample.com/a", "example.com")).toBe(false);
    expect(citationMatchesDomain("not a url", "example.com")).toBe(false);
    expect(citationMatchesDomain("https://example.com", "")).toBe(false);
  });
});

describe("analyze", () => {
  it("ranks brand among competitors by first mention", () => {
    const r = analyze(target, {
      answer: "Try Acme, then Example, then Globex.",
      citations: [{ url: "https://example.com/" }],
    });
    expect(r.brandMentioned).toBe(true);
    expect(r.mentionRank).toBe(2);
    expect(r.domainCited).toBe(true);
    expect(r.competitorsMentioned).toEqual(["Acme", "Globex"]);
  });

  it("reports absence", () => {
    const r = analyze(target, { answer: "Only Acme.", citations: [] });
    expect(r.brandMentioned).toBe(false);
    expect(r.mentionRank).toBeNull();
    expect(r.domainCited).toBe(false);
  });

  it("counts aliases as brand mentions", () => {
    const r = analyze(target, { answer: "Many pick Globex or Exampel.", citations: [] });
    expect(r.brandMentioned).toBe(true);
    expect(r.mentionRank).toBe(2);
  });

  it("detects a citation on any of several client domains", () => {
    const r = analyze(target, { answer: "n/a", citations: [{ url: "https://shop.example.ae/p/1" }] });
    expect(r.domainCited).toBe(true);
  });

  it("treats a domain written in the text as a mention", () => {
    const r = analyze(target, { answer: "See shop.example.ae for details.", citations: [] });
    expect(r.brandMentioned).toBe(true);
  });

  it("does not match inside longer words", () => {
    const r = analyze(target, { answer: "Counterexamples are useful.", citations: [] });
    expect(r.brandMentioned).toBe(false);
  });

  it("matches non-Latin aliases with proper boundaries", () => {
    const t: AnalysisTarget = { brand: "Example", aliases: ["إكزامبل"], domains: [], competitors: [] };
    expect(analyze(t, { answer: "أفضل خيار هو إكزامبل في الإمارات", citations: [] }).brandMentioned).toBe(true);
    expect(analyze(t, { answer: "مإكزامبلx", citations: [] }).brandMentioned).toBe(false);
  });

  it("escapes regex characters in names", () => {
    const t: AnalysisTarget = { brand: "C++ (Pro)", aliases: [], domains: [], competitors: [] };
    expect(analyze(t, { answer: "Use C++ (Pro) today", citations: [] }).brandMentioned).toBe(true);
  });
});

describe("classifySource", () => {
  it("labels client, competitor and other domains", () => {
    expect(classifySource("https://shop.example.ae/x", target)).toBe("client");
    expect(classifySource("https://www.acme.com/y", target)).toBe("competitor");
    expect(classifySource("https://wikipedia.org/z", target)).toBe("other");
  });
});

describe("summarize", () => {
  it("ignores errored results and rates per engine", () => {
    const base = { prompt: "p", country: "AE", answer: "", citations: [], mentionRank: null, competitorsMentioned: [] };
    const s = summarize([
      { ...base, engine: "chatgpt", brandMentioned: true, domainCited: true },
      { ...base, engine: "chatgpt", brandMentioned: false, domainCited: false },
      { ...base, engine: "gemini", brandMentioned: false, domainCited: false, error: "boom" },
    ]);
    expect(s.total).toBe(2);
    expect(s.mentionRate).toBe(0.5);
    expect(s.byEngine.chatgpt.total).toBe(2);
    expect(s.byEngine.gemini).toBeUndefined();
  });
});
