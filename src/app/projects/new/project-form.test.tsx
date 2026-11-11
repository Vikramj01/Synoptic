import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { scanPricing } from "@/lib/scan-estimate";
import { ProjectForm } from "./project-form";

const engines = [
  { code: "chatgpt", label: "ChatGPT" },
  { code: "gemini", label: "Gemini" },
  { code: "perplexity", label: "Perplexity" },
  { code: "copilot", label: "Copilot" },
];
const countries = [
  { code: "US", name: "United States", region: "BASELINE" },
  { code: "AE", name: "United Arab Emirates", region: "GCC" },
];
const action = async () => ({});
const render = (props: Partial<React.ComponentProps<typeof ProjectForm>>) =>
  renderToStaticMarkup(
    <ProjectForm action={action} engines={engines} countries={countries} pricing={scanPricing({ PROVIDER: "queryingai" })} {...props} />,
  ).replace(/<!-- -->/g, "");

describe("ProjectForm cost estimate", () => {
  it("asks for prompts on a fresh form (default engines and US market are ticked)", () => {
    const html = render({ canCreateWorkspace: true });
    expect(html).toContain("Estimated cost of one scan");
    expect(html).toContain("Add prompts and select at least one engine and market to see an estimate.");
  });

  it("starts from the saved project when editing: 10 prompts x 1 engine x 1 market", () => {
    const html = render({
      mode: "edit",
      initial: {
        workspaceId: "", newWorkspace: "", name: "P", brandName: "B", brandAliases: "", domains: "x.com", competitors: "",
        prompts: Array.from({ length: 10 }, (_, i) => `prompt ${i}`).join("\n"), budget: "20",
        engines: ["chatgpt"], countries: ["US"],
      },
    });
    expect(html).toContain("10 queries");
    expect(html).toContain("about 10 credits");
    expect(html).toContain("chatgpt 10 × 1 = 10");
    expect(html).not.toContain('role="alert"'); // 10 <= budget 20
  });

  it("prices several engines and markets, and counts duplicate prompt lines once", () => {
    const html = render({
      mode: "edit",
      initial: {
        workspaceId: "", newWorkspace: "", name: "P", brandName: "B", brandAliases: "", domains: "x.com", competitors: "",
        prompts: "a\nb\na\n\n", budget: "", engines: ["chatgpt", "gemini"], countries: ["US", "AE"],
      },
    });
    // 2 unique prompts x 2 engines x 2 markets = 8 queries; chatgpt 4 x 1 + gemini 4 x 1.25 = 9
    expect(html).toContain("8 queries");
    expect(html).toContain("about 9 credits");
    expect(html).toContain("gemini 4 × 1.25 = 5");
  });

  it("warns when the budget is lower than one scan", () => {
    const html = render({
      mode: "edit",
      initial: {
        workspaceId: "", newWorkspace: "", name: "P", brandName: "B", brandAliases: "", domains: "x.com", competitors: "",
        prompts: Array.from({ length: 10 }, (_, i) => `p${i}`).join("\n"), budget: "5", engines: ["chatgpt"], countries: ["US"],
      },
    });
    expect(html).toContain("Your monthly budget (5) is lower than one full scan (10), so scans would be refused.");
  });

  it("says no credits are used with the mock provider", () => {
    const html = render({
      pricing: scanPricing({ PROVIDER: "mock" }),
      mode: "edit",
      initial: {
        workspaceId: "", newWorkspace: "", name: "P", brandName: "B", brandAliases: "", domains: "x.com", competitors: "",
        prompts: "a", budget: "1", engines: ["chatgpt"], countries: ["US"],
      },
    });
    expect(html).toContain("no credits used (mock provider)");
    expect(html).not.toContain('role="alert"');
  });
});
