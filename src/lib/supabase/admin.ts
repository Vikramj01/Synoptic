import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";

/**
 * Service-role client: BYPASSES RLS. Only for server-side jobs that must write
 * tables users cannot write (scan runs, answers, analysis, credit ledger).
 *
 * Rules for callers:
 *  - authorise the user first (with the normal client / workspace_role) and
 *    scope every query to the project you just authorised;
 *  - never return its rows to the browser without going through user-scoped reads.
 */
export function createAdminClient() {
  const { url } = supabaseConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set on the server (see .env.example).");
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
