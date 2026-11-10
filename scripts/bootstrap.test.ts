import { describe, expect, it } from "vitest";
import {
  bootstrapOperator,
  checkServiceKey,
  inspectKey,
  parseProjectRef,
  type BootstrapPorts,
} from "./bootstrap";

function fakePorts() {
  const agencies = new Map<string, { id: string; timezone: string }>();
  const users = new Map<string, string>();
  const operators = new Set<string>();
  let n = 0;
  const ports: BootstrapPorts = {
    async findAgencyIdByName(name) {
      return agencies.get(name)?.id ?? null;
    },
    async createAgency(name, timezone) {
      const id = `agency-${++n}`;
      agencies.set(name, { id, timezone });
      return id;
    },
    async findUserIdByEmail(email) {
      return users.get(email) ?? null;
    },
    async createUser(email) {
      const id = `user-${++n}`;
      users.set(email, id);
      return id;
    },
    async upsertOperator(agencyId, userId) {
      operators.add(`${agencyId}:${userId}`);
    },
  };
  return { ports, agencies, users, operators };
}

const opts = { agencyName: "Vimi Digital", email: "Op@Example.com", timezone: "Asia/Dubai" };

describe("bootstrapOperator", () => {
  it("creates agency, user and operator membership", async () => {
    const f = fakePorts();
    const r = await bootstrapOperator(f.ports, opts);
    expect(r.agencyCreated).toBe(true);
    expect(r.userCreated).toBe(true);
    expect(f.agencies.get("Vimi Digital")?.timezone).toBe("Asia/Dubai");
    expect(f.users.has("op@example.com")).toBe(true); // email lower-cased
    expect(f.operators.has(`${r.agencyId}:${r.userId}`)).toBe(true);
  });

  it("is idempotent when re-run", async () => {
    const f = fakePorts();
    const first = await bootstrapOperator(f.ports, opts);
    const second = await bootstrapOperator(f.ports, opts);
    expect(second.agencyCreated).toBe(false);
    expect(second.userCreated).toBe(false);
    expect(second.agencyId).toBe(first.agencyId);
    expect(second.userId).toBe(first.userId);
    expect(f.agencies.size).toBe(1);
    expect(f.users.size).toBe(1);
    expect(f.operators.size).toBe(1);
  });

  it("reuses an existing user for a new agency", async () => {
    const f = fakePorts();
    await bootstrapOperator(f.ports, opts);
    const r = await bootstrapOperator(f.ports, { ...opts, agencyName: "Second Agency" });
    expect(r.agencyCreated).toBe(true);
    expect(r.userCreated).toBe(false);
    expect(f.operators.size).toBe(2);
  });

  it("rejects bad input before touching the database", async () => {
    const f = fakePorts();
    await expect(bootstrapOperator(f.ports, { ...opts, email: "nope" })).rejects.toThrow(/email/);
    await expect(bootstrapOperator(f.ports, { ...opts, agencyName: "  " })).rejects.toThrow(/agency/);
    await expect(bootstrapOperator(f.ports, { ...opts, timezone: "Mars/Base" })).rejects.toThrow(/timezone/);
    expect(f.agencies.size + f.users.size + f.operators.size).toBe(0);
  });
});

describe("parseProjectRef", () => {
  it("reads the ref from a Supabase URL", () => {
    expect(parseProjectRef("https://abcdefgh.supabase.co")).toBe("abcdefgh");
  });
  it("rejects a malformed URL", () => {
    expect(() => parseProjectRef("not a url")).toThrow(/valid URL/);
  });
});

function jwt(role: string, ref: string): string {
  const payload = Buffer.from(JSON.stringify({ role, ref })).toString("base64url");
  return `hdr.${payload}.sig`;
}

describe("service key checks", () => {
  it("classifies keys without needing the secret", () => {
    expect(inspectKey("sb_secret_abc").kind).toBe("secret");
    expect(inspectKey("sb_publishable_abc").kind).toBe("publishable");
    expect(inspectKey(jwt("service_role", "proj1"))).toEqual({ kind: "legacy-service-role", ref: "proj1" });
    expect(inspectKey(jwt("anon", "proj1")).kind).toBe("legacy-anon");
    expect(inspectKey("placeholder").kind).toBe("unknown");
  });

  it("accepts a secret key and a matching legacy service-role key", () => {
    expect(() => checkServiceKey("sb_secret_abc", "proj1")).not.toThrow();
    expect(() => checkServiceKey(jwt("service_role", "proj1"), "proj1")).not.toThrow();
  });

  it("rejects public keys, wrong-project keys, junk and bad formatting", () => {
    expect(() => checkServiceKey("sb_publishable_abc", "proj1")).toThrow(/public/);
    expect(() => checkServiceKey(jwt("anon", "proj1"), "proj1")).toThrow(/public/);
    expect(() => checkServiceKey(jwt("service_role", "other"), "proj1")).toThrow(/other.*proj1/);
    expect(() => checkServiceKey("paste your key here", "proj1")).toThrow(/spaces|quotes/);
    expect(() => checkServiceKey("placeholder", "proj1")).toThrow(/recognisable/);
    expect(() => checkServiceKey('"sb_secret_abc"', "proj1")).toThrow(/quotes/);
  });
});
