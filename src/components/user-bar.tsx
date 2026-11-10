import { getCurrentUser } from "@/lib/auth";

/** Reads the session, so render it inside <Suspense> (Cache Components). */
export async function UserBar() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <div className="flex items-center justify-end gap-3 px-6 py-2 text-xs text-neutral-500">
      <span>{user.email}</span>
      <form action="/auth/signout" method="post">
        <button type="submit" className="underline">
          Sign out
        </button>
      </form>
    </div>
  );
}
