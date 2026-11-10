/**
 * Bootstrap the first agency and its first operator.
 *
 * Why this exists: RLS deliberately has no insert policy for `agencies` and
 * for the first `agency_members` row, so nobody can create the very first
 * tenant through the API. This script does it once, with the service-role key.
 *
 * Usage (idempotent, safe to re-run):
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   npm run bootstrap -- \
 *     --agency "Vimi Digital" \
 *     --email you@example.com \
 *     --confirm-project-ref <ref>
 *
 * Optional: --timezone Asia/Dubai (default UTC). `.env` is loaded automatically
 * if present.
 *
 * Safety: --confirm-project-ref must equal the project ref in SUPABASE_URL, so
 * the script can never run against a different Supabase project by accident.
 *
 * The operator account is created pre-confirmed with no password; they sign in
 * with a magic link / email OTP (FR-1). The service-role key is read from the
 * environment only and is never printed or written anywhere.
 */
import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export interface BootstrapOptions {
  agencyName: string;
  email: string;
  timezone: string;
}

/** The few database operations the bootstrap needs; faked in tests. */
export interface BootstrapPorts {
  findAgencyIdByName(name: string): Promise<string | null>;
  createAgency(name: string, timezone: string): Promise<string>;
  findUserIdByEmail(email: string): Promise<string | null>;
  createUser(email: string): Promise<string>;
  upsertOperator(agencyId: string, userId: string): Promise<void>;
}

export interface BootstrapResult {
  agencyId: string;
  userId: string;
  agencyCreated: boolean;
  userCreated: boolean;
}

export function parseProjectRef(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`SUPABASE_URL is not a valid URL: ${url}`);
  }
  const ref = host.split(".")[0];
  if (!ref) throw new Error(`Cannot read a project ref from SUPABASE_URL: ${url}`);
  return ref;
}

export function validateOptions(opts: BootstrapOptions): void {
  if (!opts.agencyName.trim()) throw new Error("--agency must not be empty");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(opts.email)) {
    throw new Error(`--email is not a valid email address: ${opts.email}`);
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: opts.timezone });
  } catch {
    throw new Error(`--timezone is not a valid IANA timezone: ${opts.timezone}`);
  }
}

export async function bootstrapOperator(
  ports: BootstrapPorts,
  opts: BootstrapOptions,
): Promise<BootstrapResult> {
  validateOptions(opts);
  const email = opts.email.trim().toLowerCase();
  const name = opts.agencyName.trim();

  let agencyId = await ports.findAgencyIdByName(name);
  const agencyCreated = agencyId === null;
  if (agencyId === null) agencyId = await ports.createAgency(name, opts.timezone);

  let userId = await ports.findUserIdByEmail(email);
  const userCreated = userId === null;
  if (userId === null) userId = await ports.createUser(email);

  await ports.upsertOperator(agencyId, userId);
  return { agencyId, userId, agencyCreated, userCreated };
}

/** Adapter from the ports onto a real Supabase service-role client. */
export function supabasePorts(url: string, serviceRoleKey: string): BootstrapPorts {
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async findAgencyIdByName(name) {
      const { data, error } = await db.from("agencies").select("id").eq("name", name).limit(2);
      if (error) throw new Error(`Looking up agency failed: ${error.message}`);
      if (data.length > 1) {
        throw new Error(`More than one agency is named "${name}"; resolve this by hand.`);
      }
      return data[0]?.id ?? null;
    },
    async createAgency(name, timezone) {
      const { data, error } = await db
        .from("agencies")
        .insert({ name, timezone })
        .select("id")
        .single();
      if (error) throw new Error(`Creating agency failed: ${error.message}`);
      return data.id;
    },
    async findUserIdByEmail(email) {
      const perPage = 200;
      for (let page = 1; ; page++) {
        const { data, error } = await db.auth.admin.listUsers({ page, perPage });
        if (error) throw new Error(`Listing users failed: ${error.message}`);
        const hit = data.users.find((u) => u.email?.toLowerCase() === email);
        if (hit) return hit.id;
        if (data.users.length < perPage) return null;
      }
    },
    async createUser(email) {
      const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
      if (error) throw new Error(`Creating user failed: ${error.message}`);
      return data.user.id;
    },
    async upsertOperator(agencyId, userId) {
      const { error } = await db
        .from("agency_members")
        .upsert(
          { agency_id: agencyId, user_id: userId, role: "operator" },
          { onConflict: "agency_id,user_id" },
        );
      if (error) throw new Error(`Granting operator role failed: ${error.message}`);
    },
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      agency: { type: "string" },
      email: { type: "string" },
      timezone: { type: "string", default: "UTC" },
      "confirm-project-ref": { type: "string" },
    },
  });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see the header of this file).");
  }
  if (!values.agency || !values.email) {
    throw new Error('Required: --agency "<name>" --email <address> --confirm-project-ref <ref>');
  }

  const ref = parseProjectRef(url);
  if (values["confirm-project-ref"] !== ref) {
    throw new Error(
      `Refusing to run: SUPABASE_URL points at project "${ref}" but --confirm-project-ref ` +
        `was ${values["confirm-project-ref"] ? `"${values["confirm-project-ref"]}"` : "not given"}. ` +
        "Pass the ref you intend to modify.",
    );
  }

  const result = await bootstrapOperator(supabasePorts(url, key), {
    agencyName: values.agency,
    email: values.email,
    timezone: values.timezone ?? "UTC",
  });

  console.log(`Project:  ${ref}`);
  console.log(`Agency:   ${values.agency} (${result.agencyId}) ${result.agencyCreated ? "created" : "already existed"}`);
  console.log(`Operator: ${values.email} (${result.userId}) ${result.userCreated ? "created" : "already existed"}`);
  console.log("Done. The operator can now sign in with a magic link / email OTP.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
