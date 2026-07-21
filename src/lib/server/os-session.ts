import 'server-only';

import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

import { cookies } from 'next/headers';

import { env } from '@/lib/env';

/**
 * Shared auth primitives for the `apar_os_uid` session — password hashing,
 * cookie signing, and cookie read/write.
 *
 * These live here rather than in `os-auth.ts` because that file is
 * `'use server'`, and a 'use server' module may export ONLY async functions:
 * a sync export passes local tsc but breaks the Vercel build, and even a
 * re-exported type corrupts the action manifest at runtime and 500s every
 * action in the file. `os-auth.ts` and the employee portal both import from
 * here instead.
 *
 * The session cookie is shared by two populations:
 *   - staff OS accounts (the /os lock screen), and
 *   - employee portal accounts (`os_users.employee_id` is set).
 * Resolving which one a session belongs to is `server/portal/session.ts`'s
 * job; this module only proves the cookie is authentic.
 */

export const SESSION_COOKIE = 'apar_os_uid';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * Cookie `Domain`. Unset ⇒ host-only (the historical behaviour, and the right
 * default for localhost and Vercel previews, which reject a cookie scoped to a
 * domain they don't belong to). Set it to the apex (`.example.com`) in
 * production so one session is valid on both the main host and the employee
 * portal subdomain — without it every portal visit is a login loop.
 *
 * MUST be passed to `delete` as well as `set`: a bare delete does not clear a
 * domain-scoped cookie, and sign-out fails silently.
 */
function cookieDomain(): string | undefined {
  return process.env.COOKIE_DOMAIN || undefined;
}

/**
 * HMAC key for the session cookie.
 *
 * Prefers OS_SESSION_SECRET, falling back to SUPABASE_SERVICE_ROLE_KEY — which
 * is what every currently-issued cookie was signed with, so existing sessions
 * survive. There is deliberately NO hard-coded fallback: the previous literal
 * meant anyone reading the source could forge a session for any user id.
 */
function sessionSecret(): string {
  const secret = env.OS_SESSION_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error(
      'No session secret configured. Set OS_SESSION_SECRET (or SUPABASE_SERVICE_ROLE_KEY).',
    );
  }
  return secret;
}

/* -------------------------------------------------------------------------- */
/* Password hashing (scrypt)                                                  */
/* -------------------------------------------------------------------------- */

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[1]!, 'hex');
    const expected = Buffer.from(parts[2]!, 'hex');
    const actual = scryptSync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Cookie signing                                                             */
/* -------------------------------------------------------------------------- */

export function signSession(id: string): string {
  const mac = createHmac('sha256', sessionSecret()).update(id).digest('hex');
  return `${id}.${mac}`;
}

export function verifySignedSession(token: string | undefined): string | null {
  if (!token) return null;
  // os_users.id is text and may itself contain dots, so split on the LAST one.
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac('sha256', sessionSecret()).update(id).digest('hex');
  try {
    const a = Buffer.from(mac, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && timingSafeEqual(a, b) ? id : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Cookie read / write                                                        */
/* -------------------------------------------------------------------------- */

/** The authenticated `os_users.id`, or null when there is no valid cookie. */
export async function readOsSessionUserId(): Promise<string | null> {
  const store = await cookies();
  return verifySignedSession(store.get(SESSION_COOKIE)?.value);
}

export async function setOsSessionCookie(id: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, signSession(id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
    domain: cookieDomain(),
  });
}

export async function clearOsSessionCookie(): Promise<void> {
  const store = await cookies();
  // Domain must match the one used at `set`, or a domain-scoped cookie
  // survives and the user stays signed in.
  store.delete({ name: SESSION_COOKIE, path: '/', domain: cookieDomain() });
}
