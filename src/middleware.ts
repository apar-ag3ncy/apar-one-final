import { NextResponse, type NextRequest } from 'next/server';

/**
 * Employee-portal gate.
 *
 * `/me/*` requires an employee session. This is a fast, edge-safe pre-check on
 * the presence of the signed session cookie (`apar_emp_uid`) — no crypto here.
 * The authoritative verification (signature + live/active employee) happens in
 * the (portal) layout via `currentEmployee()`, which redirects to /login if the
 * cookie is forged or stale. A missing cookie short-circuits to /login here so
 * we don't even render the portal shell.
 *
 * The old `apar_role` demo cookie is gone — auth is now the real employee
 * session (see src/lib/server/employee-auth.ts).
 */
const EMP_SESSION_COOKIE = 'apar_emp_uid';

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith('/me')) {
    const hasSession = Boolean(request.cookies.get(EMP_SESSION_COOKIE)?.value);
    if (!hasSession) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Skip Next internals + static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
