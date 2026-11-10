import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "@/lib/auth-paths";
import { updateSession, withSessionCookies } from "@/lib/supabase/proxy";

// Next.js 16 renamed `middleware` to `proxy`.
export async function proxy(request: NextRequest) {
  const { response, signedIn } = await updateSession(request);
  const { pathname } = request.nextUrl;

  if (!signedIn && !isPublicPath(pathname)) {
    if (pathname.startsWith("/api/")) {
      return withSessionCookies(
        response,
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
    }
    return withSessionCookies(response, NextResponse.redirect(new URL("/login", request.url)));
  }

  if (signedIn && pathname === "/login") {
    return withSessionCookies(response, NextResponse.redirect(new URL("/", request.url)));
  }

  return response;
}

export const config = {
  // Skip static assets and image optimisation.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
