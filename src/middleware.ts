import { NextResponse, type NextRequest } from 'next/server';

/**
 * Route separation between the admin OS (`/os`) and the employee OS
 * (`/employee`). This is a fast, edge-safe pre-check on the presence of the
 * signed employee-session cookie (`apar_emp_uid`) — no crypto here. The
 * authoritative verification (HMAC signature + live/active employee) happens in
 * the `/employee` page via `currentEmployee()`; a forged/stale cookie renders
 * nothing and bounces to /login there.
 *
 *   - `/employee/*` requires an employee session, else → /login.
 *   - An employee session must NEVER reach the admin OS: `/os/*` with the
 *     employee cookie → /employee. (Operators have no employee cookie, so they
 *     are unaffected and get the admin lock screen as before.)
 *   - Legacy `/me/*` also requires the cookie (the (portal) layout forwards it
 *     to /employee).
 */
const EMP_SESSION_COOKIE = 'apar_emp_uid';

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const hasEmployeeSession = Boolean(request.cookies.get(EMP_SESSION_COOKIE)?.value);

  // Employee workspace (and the deprecated /me portal): require the cookie.
  if (pathname.startsWith('/employee') || pathname.startsWith('/me')) {
    if (!hasEmployeeSession) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Admin OS: an employee session is bounced to its own workspace so a
  // teammate can never land on the operator surface.
  if (pathname === '/os' || pathname.startsWith('/os/')) {
    if (hasEmployeeSession) {
      const url = request.nextUrl.clone();
      url.pathname = '/employee';
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Skip Next internals + static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
