import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authEnabled, isValidSession } from "@/lib/auth";

/** Site password gate (only when SITE_PASSWORD is set). */
export function proxy(req: NextRequest) {
  if (!authEnabled() || isValidSession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const login = new URL("/login", req.url);
  login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    // Skipped: the login page/API, the harmless status check, static assets, and the book upload
    // route — proxy buffers request bodies in memory, so uploads check the session in the route itself.
    "/((?!login|api/login|api/status|api/teachers/.+/sources|_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|webp|gif|ico|woff2?|glb|gltf|hdr|mp3|wav)$).*)",
  ],
};
