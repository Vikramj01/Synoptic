import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Synoptic" };

export default function LoginPage() {
  return (
    <main className="mx-auto w-full max-w-sm space-y-6 p-6 pt-24">
      <header>
        <h1 className="text-2xl font-semibold">Synoptic</h1>
        <p className="text-sm text-neutral-500">Sign in with a magic link.</p>
      </header>
      {/* useSearchParams needs a Suspense boundary under Cache Components */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
