'use server';

// Employee login — the Supabase-free session behind the employee OS workspace
// (/login → /os → EmployeeDesktop). The old /me portal is deprecated.
//
// Mirrors the OS lock-screen auth in `os-auth.ts`: passwords are scrypt-hashed
// in Postgres (`employees.password_hash`) and a signed, httpOnly cookie carries
// the session. No `auth.users`, no Supabase client, no `currentUser()`. The
// session token is BOUND to the current password hash (see session-token.ts),
// so a password change / reset / revoke invalidates outstanding sessions.
//
// Identity: the employee signs in with their **work email**. `password_hash`
// NULL ⇒ no portal access yet (an admin sets an initial password from the OS
// employee window → OS access tab). Archived / separated / soft-deleted
// employees cannot sign in and any live session for them stops resolving.
//
// Authorization split:
//   - signInEmployee / signOutEmployee / changeMyPassword → the employee.
//   - setEmployeePassword / getEmployeePortalAccess / revoke → an admin OS
//     operator (isOsAdminOperator), since HR sets/resets the password. Employee
//     sessions are separately denied an admin actor in actor.ts.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { cookies } from 'next/headers';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';
import { isOsAdminOperator } from '@/lib/server/os-auth';
import { signToken, splitToken, tokenMatches } from '@/lib/server/session-token';

const SESSION_COOKIE = 'apar_emp_uid';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const MIN_PASSWORD_LENGTH = 6;

const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_MAX_AGE,
};

export type SafeEmployee = {
  id: string;
  employeeCode: string;
  fullName: string;
  displayName: string | null;
  workEmail: string | null;
  designation: string | null;
  department: string | null;
  status: string;
  joinedOn: string;
};

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

/* -------------------------------------------------------------------------- */
/* Password hashing (scrypt) + cookie signing (HMAC) — same scheme as os-auth */
/* -------------------------------------------------------------------------- */

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
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

// Employee-session HMAC secret. Prefers a dedicated secret, then the OS secret,
// then the Supabase service-role key so an existing deploy keeps working. In
// production it refuses to fall through to the public dev constant — fail
// loudly rather than sign cookies with a source-embedded key anyone could use
// to forge sessions. (Only reached when a request actually carries a session
// cookie, so a mis-set env never breaks anonymous/admin traffic.)
function sessionSecret(): string {
  const secret =
    process.env.APP_SESSION_SECRET ||
    process.env.OS_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    '';
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'No session secret configured. Set APP_SESSION_SECRET (or OS_SESSION_SECRET) in production.',
      );
    }
    return 'apar-emp-dev-only-secret';
  }
  return secret;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function sanitize(row: typeof employees.$inferSelect): SafeEmployee {
  return {
    id: row.id,
    employeeCode: row.employeeCode,
    fullName: row.fullName,
    displayName: row.displayName ?? null,
    workEmail: row.workEmail ?? null,
    designation: row.designation ?? null,
    department: row.department ?? null,
    status: row.status,
    joinedOn: String(row.joinedOn),
  };
}

// A live employee eligible for portal access: not soft-deleted, not archived,
// not separated.
function liveAndActive() {
  return and(
    isNull(employees.deletedAt),
    eq(employees.isArchived, false),
    sql`${employees.status} <> 'separated'`,
  );
}

// One-shot per server process: ensure the portal password column exists.
// Mirrors ensureDevAdmin / ensureOsSuperAdmin in this codebase — a self-heal
// for when a migration (here 0082) hasn't been applied to the target database
// (this project's deploy does not run drizzle-kit migrate). `ADD COLUMN IF NOT
// EXISTS` is idempotent and safe to race across cold starts.
let portalColumnEnsured = false;
async function ensureEmployeePortalColumn(): Promise<void> {
  if (portalColumnEnsured) return;
  try {
    await db.execute(sql`ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "password_hash" text`);
    portalColumnEnsured = true;
  } catch (e) {
    // Best-effort. Mark ensured so we don't hammer DDL on every request; if the
    // column genuinely can't be added (e.g. missing privilege) the caller's
    // query surfaces a clean error and we fall back to applying 0082 manually.
    console.error('[employee-auth] ensureEmployeePortalColumn failed', e);
    portalColumnEnsured = true;
  }
}

/* -------------------------------------------------------------------------- */
/* Employee-facing actions                                                    */
/* -------------------------------------------------------------------------- */

export async function signInEmployee(
  email: string,
  password: string,
): Promise<Result<{ employee: SafeEmployee }>> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !password) {
    return { ok: false, error: 'Enter your work email and password.' };
  }

  await ensureEmployeePortalColumn();

  let row: typeof employees.$inferSelect | undefined;
  try {
    const rows = await db
      .select()
      .from(employees)
      .where(and(sql`lower(${employees.workEmail}) = ${normalized}`, liveAndActive()))
      .limit(1);
    row = rows[0];
  } catch (e) {
    // A DB error here (e.g. the password_hash column not yet migrated) must
    // surface as a clean, uniform failure — never a raw 500 exposing SQL.
    console.error('[signInEmployee] query failed', e);
    return { ok: false, error: 'Sign-in is temporarily unavailable. Please try again later.' };
  }

  // One uniform message whether the email is unknown, has no portal access, or
  // the password is wrong — so the response never confirms which emails exist.
  if (!row || !row.passwordHash || !verifyPassword(password, row.passwordHash)) {
    return { ok: false, error: 'Incorrect email or password.' };
  }

  const store = await cookies();
  store.set(
    SESSION_COOKIE,
    signToken(sessionSecret(), row.id, row.passwordHash),
    SESSION_COOKIE_OPTS,
  );
  return { ok: true, employee: sanitize(row) };
}

export async function signOutEmployee(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * Resolve the signed-in employee for the current request, or null. Re-checks
 * that the employee is still live/active so a separated or archived teammate's
 * cookie stops working immediately.
 */
export async function currentEmployee(): Promise<SafeEmployee | null> {
  const store = await cookies();
  const parsed = splitToken(store.get(SESSION_COOKIE)?.value);
  if (!parsed) return null;

  await ensureEmployeePortalColumn();

  const [row] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, parsed.id), liveAndActive()))
    .limit(1);

  // Invalid when: no live row, portal access revoked (null hash), or the MAC
  // doesn't match the CURRENT password hash (password changed/reset since the
  // token was issued — the token is bound to the hash, so stale ones die).
  if (
    !row ||
    !row.passwordHash ||
    !tokenMatches(sessionSecret(), parsed.id, row.passwordHash, parsed.mac)
  ) {
    return null;
  }
  return sanitize(row);
}

export async function changeMyPassword(
  currentPassword: string,
  newPassword: string,
): Promise<Result> {
  const store = await cookies();
  const parsed = splitToken(store.get(SESSION_COOKIE)?.value);
  if (!parsed) return { ok: false, error: 'Your session has expired. Sign in again.' };

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  await ensureEmployeePortalColumn();

  const [row] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, parsed.id), liveAndActive()))
    .limit(1);

  if (
    !row ||
    !row.passwordHash ||
    !tokenMatches(sessionSecret(), parsed.id, row.passwordHash, parsed.mac)
  ) {
    return { ok: false, error: 'Your session has expired. Sign in again.' };
  }
  if (!verifyPassword(currentPassword, row.passwordHash)) {
    return { ok: false, error: 'Current password is incorrect.' };
  }

  const newHash = hashPassword(newPassword);
  await db.update(employees).set({ passwordHash: newHash }).where(eq(employees.id, parsed.id));

  // Re-issue this session bound to the new hash so the user stays signed in;
  // any OTHER outstanding sessions (bound to the old hash) are now invalid.
  store.set(SESSION_COOKIE, signToken(sessionSecret(), parsed.id, newHash), SESSION_COOKIE_OPTS);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Operator-facing actions (OS session required)                              */
/* -------------------------------------------------------------------------- */

/** Portal-access status for the OS employee window. Operator-only. */
export async function getEmployeePortalAccess(
  employeeId: string,
): Promise<
  { ok: true; workEmail: string | null; hasPassword: boolean } | { ok: false; error: string }
> {
  if (!(await isOsAdminOperator())) return { ok: false, error: 'Not authorized.' };

  await ensureEmployeePortalColumn();

  const [row] = await db
    .select({ workEmail: employees.workEmail, passwordHash: employees.passwordHash })
    .from(employees)
    .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)))
    .limit(1);

  if (!row) return { ok: false, error: 'Employee not found.' };
  return { ok: true, workEmail: row.workEmail ?? null, hasPassword: Boolean(row.passwordHash) };
}

/** HR sets / resets an employee's portal password. Operator-only. */
export async function setEmployeePassword(
  employeeId: string,
  newPassword: string,
): Promise<Result> {
  if (!(await isOsAdminOperator())) return { ok: false, error: 'Not authorized.' };

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  await ensureEmployeePortalColumn();

  const [row] = await db
    .select({ id: employees.id, workEmail: employees.workEmail })
    .from(employees)
    .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)))
    .limit(1);

  if (!row) return { ok: false, error: 'Employee not found.' };
  if (!row.workEmail) {
    return { ok: false, error: 'Set a work email on this employee first — it is the login id.' };
  }

  await db
    .update(employees)
    .set({ passwordHash: hashPassword(newPassword) })
    .where(eq(employees.id, employeeId));
  return { ok: true };
}

/** HR revokes portal access (clears the password). Operator-only. */
export async function revokeEmployeePortalAccess(employeeId: string): Promise<Result> {
  if (!(await isOsAdminOperator())) return { ok: false, error: 'Not authorized.' };
  await ensureEmployeePortalColumn();
  await db
    .update(employees)
    .set({ passwordHash: null })
    .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)));
  return { ok: true };
}
