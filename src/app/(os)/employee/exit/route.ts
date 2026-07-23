import { NextResponse, type NextRequest } from 'next/server';

/**
 * Recovery route for a *broken* employee session. The `apar_emp_uid` cookie is
 * still present in the browser — so `middleware.ts` (a presence-only check)
 * keeps bouncing `/os` → `/employee` — but `currentEmployee()` can no longer
 * resolve it: the employee was deactivated/separated, their password was reset,
 * portal access was revoked, or the cookie is stale/forged.
 *
 * `/employee`'s page sends the unresolved case here instead of straight to
 * `/os`. We clear the dead cookie and hand off to the unified sign-in at `/os`.
 * Without this the pair would loop forever — `/os → /employee → /os → …`
 * (ERR_TOO_MANY_REDIRECTS) — because neither the server component (which cannot
 * mutate cookies during render) nor the presence-only middleware ever drops it.
 *
 * A route handler is the one place allowed to delete a cookie *and* redirect,
 * so it is the single choke point that heals every entry (`/os`, `/login`,
 * `(portal)`): each funnels through the middleware bounce to `/employee`, which
 * lands here.
 */
export function GET(request: NextRequest) {
  const res = NextResponse.redirect(new URL('/os', request.url));
  // Match the attributes the cookie was set with (path '/') so the browser
  // actually drops it; otherwise the bounce never stops.
  res.cookies.delete({ name: 'apar_emp_uid', path: '/' });
  return res;
}
