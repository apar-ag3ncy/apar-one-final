import { NextResponse, type NextRequest } from 'next/server';

/**
 * Hostname routing for the employee portal.
 *
 * Renamed from `middleware.ts`: Next 16 deprecated the `middleware` file
 * convention in favour of `proxy` (the old name still runs but logs a
 * deprecation on every build).
 *
 * WHAT THIS DOES: route by Host header, nothing more. The installed docs are
 * explicit that Proxy "should not be used as a full session management or
 * authorization solution" — it is for optimistic redirects. Real access
 * control lives in `(portal)/me/layout.tsx` and, independently, in every
 * portal server function via `requirePortalEmployee()`. That double-guarding
 * matters because proxy matchers also gate Server Actions (they are POSTs to
 * the route they live on), so a path-based rule can never be the only defence.
 *
 * WHAT IT DELIBERATELY NO LONGER DOES: the previous implementation read an
 * `apar_role` cookie that nothing in the codebase ever set, DEFAULTED a
 * cookie-less visitor to `'admin'`, and unconditionally waved every `/me`
 * request through. All of that is gone.
 *
 * PORTAL_HOST unset ⇒ this is a no-op, so localhost and Vercel previews
 * (*.vercel.app) behave normally. It is read from `process.env` inside the
 * function body on purpose: `config.matcher` values must be build-time
 * constants ("dynamic values such as variables will be ignored"), so the
 * hostname cannot be expressed as a matcher `has: [{ type: 'host' }]` rule.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Framework internals and API routes are never re-routed. Proxy still runs
  // for /_next/data/* even when the matcher excludes it (intentional, per the
  // docs), so RSC/data requests must fall through exactly like their HTML
  // counterparts or the two would diverge.
  if (pathname.startsWith('/_next') || pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  const portalHost = process.env.PORTAL_HOST?.trim().toLowerCase();
  if (!portalHost) return NextResponse.next();

  // Strip the port: Host is `example.com:3000` locally.
  const host = request.headers.get('host')?.split(':')[0]?.toLowerCase();
  if (!host || host !== portalHost) return NextResponse.next();

  /* ---- On the portal hostname ------------------------------------------- */

  // The portal lives at /me/*. Serve it at the root of the subdomain, but
  // REWRITE (not redirect) so the /me prefix stays in the URL space that every
  // nav href and redirect('/me/...') already uses — stripping it would make
  // them all double-prefix to /me/me/...
  if (pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/me';
    return NextResponse.rewrite(url);
  }

  if (pathname === '/sign-in' || pathname === '/me' || pathname.startsWith('/me/')) {
    return NextResponse.next();
  }

  // Everything else on this hostname is a staff surface (/os, /clients,
  // /ledger, …). Employees have no business there, so bounce to their home
  // rather than rendering an app they cannot use.
  const url = request.nextUrl.clone();
  url.pathname = '/me';
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals + static assets. Must be a build-time constant.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
