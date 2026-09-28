import { type NextRequest, NextResponse } from "next/server";

/**
 * Forwards the requested path to Server Components (x-pathname) so protected layouts can
 * send unauthenticated users to sign-in with a safe return URL. Authorization itself is
 * always enforced server-side in layouts, route handlers and PostgreSQL policies.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|icons|sw.js|favicon.ico|manifest.webmanifest).*)"],
};
