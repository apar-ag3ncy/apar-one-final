'use server';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { employees, osUsers } from '@/lib/db/schema';
import {
  clearOsSessionCookie,
  setOsSessionCookie,
  verifyPassword,
} from '@/lib/server/os-session';

/**
 * Employee portal sign-in / sign-out.
 *
 * Separate from `os-auth.ts#signInOs` on purpose:
 *
 *   - It NEVER calls `bootstrapOsAuth()`. That returns every `os_users` row
 *     (ids, usernames, full names, roles, permission maps) to an
 *     UNAUTHENTICATED caller so the OS lock screen can draw avatars. On a
 *     public portal hostname that would be a staff-roster enumeration
 *     endpoint plus a ready-made username list for brute forcing.
 *   - It only accepts accounts that are linked to a live, active employee, so
 *     a staff/OS account cannot sign in through the portal (and vice versa the
 *     portal guard rejects staff sessions).
 *   - It throttles attempts, which `signInOs` does not do at all.
 *
 * Errors are deliberately identical for "no such user" and "wrong password" so
 * the portal cannot be used to test whether someone works here.
 */

const GENERIC_ERROR = 'Incorrect username or password.';

/* -------------------------------------------------------------------------- */
/* Throttling                                                                 */
/* -------------------------------------------------------------------------- */

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 8;

/**
 * Per-username attempt counter.
 *
 * Best-effort only: serverless instances each keep their own map, so this
 * slows down credential stuffing rather than stopping it. A shared store
 * (Postgres/Redis) would be needed for a hard guarantee — noted rather than
 * pretended.
 */
const attempts = new Map<string, { count: number; firstAt: number }>();

function throttled(key: string): boolean {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec) return false;
  if (now - rec.firstAt > ATTEMPT_WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return rec.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.firstAt > ATTEMPT_WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now });
    return;
  }
  rec.count += 1;
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

export async function signInPortal(
  username: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const uname = username.trim().toLowerCase();
  if (!uname || !password) return { ok: false, error: GENERIC_ERROR };

  if (throttled(uname)) {
    return {
      ok: false,
      error: 'Too many attempts. Wait a few minutes and try again.',
    };
  }

  // Only employee-linked accounts (INNER JOIN). A staff/OS account therefore
  // cannot sign in here at all. Username is matched case-insensitively in SQL,
  // mirroring the os_users_username_lower_unique index.
  const [match] = await db
    .select({
      id: osUsers.id,
      passwordHash: osUsers.passwordHash,
      employeeStatus: employees.status,
      employeeArchived: employees.isArchived,
    })
    .from(osUsers)
    .innerJoin(employees, eq(employees.id, osUsers.employeeId))
    .where(
      and(
        isNull(osUsers.deletedAt),
        isNull(employees.deletedAt),
        eq(sql`lower(${osUsers.username})`, uname),
      ),
    )
    .limit(1);

  if (!match || !verifyPassword(password, match.passwordHash)) {
    recordFailure(uname);
    return { ok: false, error: GENERIC_ERROR };
  }
  if (match.employeeArchived || match.employeeStatus === 'separated') {
    recordFailure(uname);
    return { ok: false, error: GENERIC_ERROR };
  }

  attempts.delete(uname);
  await setOsSessionCookie(match.id);
  return { ok: true };
}

export async function signOutPortal(): Promise<void> {
  await clearOsSessionCookie();
}
