"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { requestLogin, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(requestLogin, {
    status: "idle",
  });
  const linkFailed = useSearchParams().get("error") === "link";

  if (state.status === "sent") {
    return (
      <p role="status" className="text-sm">
        If <strong>{state.email}</strong> has access, a sign-in link is on its way. Open it on this
        device.
      </p>
    );
  }

  const message =
    state.status === "error"
      ? state.message
      : linkFailed
        ? "That sign-in link is invalid or has expired. Request a new one."
        : null;

  return (
    <form action={action} className="space-y-3">
      <label className="block text-sm" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent p-2 text-sm"
      />
      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
