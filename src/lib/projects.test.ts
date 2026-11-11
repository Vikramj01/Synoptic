import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  calls: [] as string[], insertArg: null as unknown, error: null as { message: string } | null,
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.rpcs.push({ fn, args });
      return { data: "new-project-id", error: h.error };
    },
    from: (table: string) => ({
      insert(row: unknown) {
        h.calls.push(`${table}.insert`);
        h.insertArg = row;
        // A real client chains .select() only if the caller asks for the row back.
        const result = Promise.resolve({ data: null, error: h.error }) as Promise<unknown> & { select: () => never };
        result.select = () => {
          h.calls.push(`${table}.select`);
          throw new Error("createWorkspace must not read the inserted row back (RLS rejects RETURNING)");
        };
        return result;
      },
    }),
  }),
}));

import { createProject, createWorkspace, updateProject, type ProjectData } from "./projects";

beforeEach(() => { h.calls.length = 0; h.insertArg = null; h.error = null; h.rpcs.length = 0; });

describe("createWorkspace", () => {
  it("supplies its own id and never asks for the row back", async () => {
    const id = await createWorkspace("agency-1", "Openart");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.insertArg).toEqual({ id, agency_id: "agency-1", name: "Openart" });
    expect(h.calls).toEqual(["workspaces.insert"]);
  });

  it("surfaces database errors", async () => {
    h.error = { message: "new row violates row-level security policy" };
    await expect(createWorkspace("agency-1", "X")).rejects.toThrow(/Creating workspace failed/);
  });
});

const data: ProjectData = {
  name: "P", brandName: "OpenArt", brandAliases: [], domains: ["openart.ai"],
  engines: ["chatgpt"], countries: ["US"], prompts: ["best AI image generators"], monthlyCreditBudget: 20,
  competitors: [
    { name: "Midjourney", domains: [], aliases: [] },
    { name: "Ideogram", domains: ["ideogram.ai"], aliases: ["Ideogram AI"] },
  ],
};

describe("project RPC payloads", () => {
  it("createProject sends competitors as structured objects with domains and aliases", async () => {
    expect(await createProject({ workspaceId: "ws", ...data })).toBe("new-project-id");
    const { fn, args } = h.rpcs[0];
    expect(fn).toBe("create_project");
    expect(args.p_competitors).toEqual(data.competitors);
    expect(args.p_monthly_credit_budget).toBe(20);
  });

  it("updateProject sends the same shape and omits the budget argument when there is no limit", async () => {
    await updateProject("proj-1", { ...data, monthlyCreditBudget: null });
    const { fn, args } = h.rpcs[0];
    expect(fn).toBe("update_project");
    expect(args.p_project).toBe("proj-1");
    expect(args.p_competitors).toEqual(data.competitors);
    expect(args).not.toHaveProperty("p_monthly_credit_budget");
  });

  it("surfaces RPC errors", async () => {
    h.error = { message: "permission denied to edit this project" };
    await expect(updateProject("proj-1", data)).rejects.toThrow(/Updating project failed: permission denied/);
  });
});
