'use server';

// Employee portal login — the /me self-service surface.
//
// Deliberately Supabase-free (the platform is moving off Supabase): this
// mirrors the OS lock-screen auth in `os-auth.ts` — passwords are scrypt-hashed
// in Postgres (`employees.password_hash`), and a signed, httpOnly cookie carries
// the session. No `auth.users`, no Supabase client, no `currentUser()`.
//
// Identity: the employee signs in with their **work email**. `password_hash`
// NULL ⇒ no portal access yet (HR sets an initial password from the OS employee
// window → Portal access tab). Archived / separated / soft-deleted employees
// cannot sign in and any live session for them stops resolving.
//
// Authorization split:
//   - signInEmployee / signOutEmployee / changeMyPassword → the employee.
//   - setEmployeePassword / getEmployeePortalAccess → an authenticated OS
//     operator (verified via the OS session cookie), since HR sets the initial
//     password. This is the only real auth boundary today (server actions
//     otherwise run under the dev-admin fallback in actor.ts).

import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

import { cookies } from 'next/headers';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';
import { currentOsUserId } from '@/lib/server/os-auth';

const SESSION_COOKIE = 'apar_emp_uid';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const MIN_PASSWORD_LENGTH = 6;

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

// Dedicated employee-session secret. Falls back to the OS secret, then a
// constant, so the app still boots in dev without extra env. Set
// APP_SESSION_SECRET in production (see .env.example).
function sessionSecret(): string {
  return (
    process.env.APP_SESSION_SECRET ||
    process.env.OS_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'apar-emp-fallback-secret'
  );
}

function signSession(id: string): string {
  const mac = createHmac('sha256', sessionSecret()).update(id).digest('hex');
  return `${id}.${mac}`;
}

function verifySignedSession(token: string | undefined): string | null {
  if (!token) return null;
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

async function requireOsOperator(): Promise<string | null> {
  return currentOsUserId();
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
  store.set(SESSION_COOKIE, signSession(row.id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
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
  const id = verifySignedSession(store.get(SESSION_COOKIE)?.value);
  if (!id) return null;

  const [row] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, id), liveAndActive()))
    .limit(1);

  return row ? sanitize(row) : null;
}

export async function changeMyPassword(
  currentPassword: string,
  newPassword: string,
): Promise<Result> {
  const store = await cookies();
  const id = verifySignedSession(store.get(SESSION_COOKIE)?.value);
  if (!id) return { ok: false, error: 'Your session has expired. Sign in again.' };

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  const [row] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, id), liveAndActive()))
    .limit(1);

  if (!row || !row.passwordHash || !verifyPassword(currentPassword, row.passwordHash)) {
    return { ok: false, error: 'Current password is incorrect.' };
  }

  await db
    .update(employees)
    .set({ passwordHash: hashPassword(newPassword) })
    .where(eq(employees.id, id));
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
  if (!(await requireOsOperator())) return { ok: false, error: 'Not authorized.' };

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
  if (!(await requireOsOperator())) return { ok: false, error: 'Not authorized.' };

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

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
  if (!(await requireOsOperator())) return { ok: false, error: 'Not authorized.' };
  await db
    .update(employees)
    .set({ passwordHash: null })
    .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)));
  return { ok: true };
}
