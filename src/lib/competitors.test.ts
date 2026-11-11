import { describe, expect, it } from "vitest";
import { formatCompetitorLines, isHostname, parseCompetitorLines } from "./competitors";

const ok = (text: string) => {
  const r = parseCompetitorLines(text);
  if ("error" in r) throw new Error(`unexpected error: ${r.error}`);
  return r.competitors;
};
const err = (text: string) => {
  const r = parseCompetitorLines(text);
  if (!("error" in r)) throw new Error("expected an error");
  return r.error;
};

describe("parseCompetitorLines", () => {
  it("accepts a bare name (backwards compatible with the old one-name-per-line form)", () => {
    expect(ok("Midjourney\nLeonardo")).toEqual([
      { name: "Midjourney", domains: [], aliases: [] },
      { name: "Leonardo", domains: [], aliases: [] },
    ]);
  });

  it("parses domains and aliases", () => {
    expect(ok("Adobe Firefly | firefly.adobe.com, adobe.com | Firefly, Adobe AI")).toEqual([
      { name: "Adobe Firefly", domains: ["firefly.adobe.com", "adobe.com"], aliases: ["Firefly", "Adobe AI"] },
    ]);
  });

  it("allows aliases without domains using an empty middle segment", () => {
    expect(ok("Leonardo || Leonardo.ai")).toEqual([{ name: "Leonardo", domains: [], aliases: ["Leonardo.ai"] }]);
  });

  it("normalises pasted URLs to bare domains and de-duplicates", () => {
    expect(ok("Ideogram | https://www.ideogram.ai/, ideogram.ai, IDEOGRAM.AI")[0].domains).toEqual(["ideogram.ai"]);
  });

  it("accepts commas, semicolons and spaces between domains", () => {
    expect(ok("X | a.com; b.com c.com,d.com")[0].domains).toEqual(["a.com", "b.com", "c.com", "d.com"]);
  });

  it("ignores blank lines and surrounding whitespace, and drops an alias equal to the name", () => {
    // "canva" and "Canva" collapse to one alias, which then equals the name (any case) and is dropped.
    expect(ok("\n  Canva  |  canva.com  |  canva, Canva \n\n")).toEqual([
      { name: "Canva", domains: ["canva.com"], aliases: [] },
    ]);
  });

  it("keeps non-Latin names and aliases", () => {
    expect(ok("أدوبي | adobe.com | أدوبي فايرفلاي")).toEqual([{ name: "أدوبي", domains: ["adobe.com"], aliases: ["أدوبي فايرفلاي"] }]);
  });

  it("rejects an invalid domain, naming the competitor and the offending value", () => {
    // spaces separate domains, so the first token that is not a hostname is reported
    expect(err("Ideogram | not a domain")).toMatch(/Ideogram.*line 1.*"not" is not a valid domain/);
    expect(err("Ideogram | ideogram")).toMatch(/"ideogram" is not a valid domain/);
  });

  it("rejects a missing name, too many separators and duplicate names", () => {
    expect(err("| ideogram.ai")).toMatch(/missing a name/);
    expect(err("A | a.com | b | c")).toMatch(/at most two/);
    expect(err("Canva\ncanva")).toMatch(/listed twice/);
  });

  it("returns an empty list for empty input", () => {
    expect(ok("")).toEqual([]);
    expect(ok("  \n \n")).toEqual([]);
  });
});

describe("formatCompetitorLines", () => {
  it("round-trips through parse", () => {
    const text = "Midjourney\nIdeogram | ideogram.ai\nAdobe Firefly | firefly.adobe.com, adobe.com | Firefly\nLeonardo |  | Leonardo.ai";
    const parsed = ok(text);
    expect(ok(formatCompetitorLines(parsed))).toEqual(parsed);
  });

  it("writes aliases-only competitors with an empty domain segment", () => {
    expect(formatCompetitorLines([{ name: "Leonardo", domains: [], aliases: ["Leonardo.ai"] }])).toBe("Leonardo |  | Leonardo.ai");
  });
});

describe("isHostname", () => {
  it("accepts hostnames and rejects junk", () => {
    expect(isHostname("shop.example.ae")).toBe(true);
    expect(isHostname("example")).toBe(false);
    expect(isHostname("exa mple.com")).toBe(false);
    expect(isHostname("")).toBe(false);
  });
});
