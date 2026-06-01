import { NextResponse, type NextRequest } from 'next/server';

/**
 * Role-aware routing per AUDIT-GAPS §3 + SPEC-AMENDMENT-001 §8.
 *
 *   - role = 'employee' → only /me/* and /(auth) are accessible. Any other
 *     path 302s to /me. /os/* explicitly redirects (the OS surface is
 *     non-employee territory; SPEC §8.2).
 *   - role != 'employee' → /me/* is currently allowed for debugging; gate
 *     strictly once dev can issue mismatched roles.
 *
 * Until Backend ships full auth, the middleware reads an `apar_role`
 * cookie set by the demo bootstrap. Swap the cookie read for a real
 * session lookup once it lands — no other changes needed.
 */
export function middleware(request: NextRequest) {
  const role = request.cookies.get('apar_role')?.value ?? 'admin';
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith('/me')) {
    return NextResponse.next();
  }

  // Employees never reach the OS. /os/* is the explicit case but the
  // condition below also covers the home page and every legacy dashboard
  // route for portal-only users.
  if (role === 'employee' && !pathname.startsWith('/api') && pathname !== '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/me';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Skip Next internals + static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
