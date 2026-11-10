/**
 * Paths reachable without a session. Everything else requires sign-in.
 * `/auth/*` holds the magic-link callback and sign-out handlers.
 */
export function isPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/auth/");
}
