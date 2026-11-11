import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ calls: [] as string[], insertArg: null as unknown, error: null as { message: string } | null }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
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

import { createWorkspace } from "./projects";

beforeEach(() => { h.calls.length = 0; h.insertArg = null; h.error = null; });

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
