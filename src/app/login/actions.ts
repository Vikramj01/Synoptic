"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export type LoginState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Prefer an explicit site URL; fall back to the request host (must also be allow-listed in Supabase). */
async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function requestLogin(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { status: "error", message: "Enter a valid email address." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Accounts are created by invitation only; never create one from the login form.
      shouldCreateUser: false,
      emailRedirectTo: `${await siteOrigin()}/auth/callback`,
    },
  });

  if (error?.status === 429) {
    return { status: "error", message: "Too many requests. Wait a minute and try again." };
  }
  // Same response whether or not the address has an account, so the form
  // can't be used to discover who has access. Real failures go to the log.
  if (error) console.error("signInWithOtp failed:", error.status, error.code);
  return { status: "sent", email };
}
