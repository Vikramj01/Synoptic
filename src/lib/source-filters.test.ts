import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, formatByEngine, parseSourceFilters, percent, safeHref, sourcesHref } from "./source-filters";

const engines = ["chatgpt", "gemini"];

describe("parseSourceFilters", () => {
  it("defaults to the latest scan, all engines, all types, by domain", () => {
    expect(parseSourceFilters({}, engines)).toEqual(DEFAULT_FILTERS);
  });

  it("reads valid values", () => {
    expect(parseSourceFilters({ scope: "all", engine: "gemini", type: "competitor", view: "pages" }, engines)).toEqual({
      scope: "all", engine: "gemini", role: "competitor", by: "url",
    });
  });

  it("ignores unknown or hostile values", () => {
    expect(parseSourceFilters({ scope: "yesterday", engine: "'; drop table x;--", type: "admin", view: "../etc" }, engines)).toEqual(DEFAULT_FILTERS);
    expect(parseSourceFilters({ engine: "meta_ai" }, engines).engine).toBeNull(); // not enabled for this project
  });

  it("takes the first of repeated params", () => {
    expect(parseSourceFilters({ engine: ["gemini", "chatgpt"], type: ["client", "other"] }, engines)).toMatchObject({ engine: "gemini", role: "client" });
  });
});

describe("sourcesHref", () => {
  it("omits defaults", () => {
    expect(sourcesHref("p1", DEFAULT_FILTERS)).toBe("/projects/p1/sources");
  });
  it("includes only non-default filters", () => {
    expect(sourcesHref("p1", { scope: "all", engine: "gemini", role: "client", by: "url" })).toBe(
      "/projects/p1/sources?scope=all&engine=gemini&type=client&view=pages",
    );
    expect(sourcesHref("p1", { ...DEFAULT_FILTERS, by: "url" })).toBe("/projects/p1/sources?view=pages");
  });
  it("round-trips through parse", () => {
    const f = { scope: "all", engine: "chatgpt", role: "other", by: "url" } as const;
    const qs = Object.fromEntries(new URL(sourcesHref("p", f), "http://x").searchParams);
    expect(parseSourceFilters(qs, engines)).toEqual(f);
  });
});

describe("safeHref", () => {
  it("allows http and https", () => {
    expect(safeHref("https://openart.ai/home")).toBe("https://openart.ai/home");
    expect(safeHref("http://example.com")).toBe("http://example.com/");
  });
  it("blocks script and other dangerous or non-web schemes", () => {
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "file:///etc/passwd", "ftp://x.com/a", "//evil.com/x", "/relative/path", "not a url", ""]) {
      expect(safeHref(bad)).toBeNull();
    }
  });
});

describe("formatting", () => {
  it("percent rounds and guards divide by zero", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
    expect(percent(5, 0)).toBe(0);
  });
  it("formatByEngine sorts by count then name", () => {
    expect(formatByEngine({ gemini: 1, chatgpt: 3, perplexity: 1 })).toBe("chatgpt 3 · gemini 1 · perplexity 1");
    expect(formatByEngine({})).toBe("");
  });
});
