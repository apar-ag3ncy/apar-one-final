import 'server-only';

import { randomBytes } from 'node:crypto';

import { isNull } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { osUsers } from '@/lib/db/schema';
import { hashPassword } from '@/lib/server/os-session';

/**
 * Portal-account provisioning, shared by the admin backfill action and by
 * `createEmployee` (so a new hire gets an account the moment they are added).
 *
 * Plain `import 'server-only'`, NOT 'use server': every export of a 'use server'
 * module becomes a callable RPC endpoint, and account creation must only ever
 * happen behind a capability check in one of the callers.
 */

/** A created account's one-time credentials, for the admin to pass on. */
export type IssuedCredential = {
  employeeId: string;
  fullName: string;
  employeeCode: string;
  username: string;
  /** Shown ONCE. Only the scrypt hash is stored — it cannot be read back. */
  tempPassword: string;
};

/**
 * A username from a person's name: first name, lowercased, non-alphanumerics
 * stripped. Collisions take a numeric suffix, then fall back to the employee
 * code — the roster genuinely contains repeated names (two "Yesha Shah"), so
 * uniqueness cannot be assumed.
 */
export function usernameFor(fullName: string, employeeCode: string, taken: Set<string>): string {
  const base =
    fullName
      .trim()
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, '') || '';
  const codeSlug = employeeCode.toLowerCase().replace(/[^a-z0-9]/g, '');
  const seed = base.length >= 3 ? base : codeSlug;

  if (!taken.has(seed)) return seed;
  for (let n = 2; n <= 99; n += 1) {
    const candidate = `${seed}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${seed}-${codeSlug}`;
}

/**
 * A readable temp password. Admin-managed: returned ONCE at creation for the
 * admin to hand over. Look-alike characters (0/O, 1/l/I) are excluded because
 * these get read aloud and typed on phones.
 */
export function tempPassword(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const pick = (set: string, n: number) =>
    Array.from(randomBytes(n))
      .map((b) => set[b % set.length])
      .join('');
  return `apar-${pick(alphabet, 4)}-${pick(digits, 4)}`;
}

/** Usernames already in use across BOTH populations — one table, one cookie. */
export async function takenUsernames(): Promise<Set<string>> {
  const rows = await db
    .select({ username: osUsers.username })
    .from(osUsers)
    .where(isNull(osUsers.deletedAt));
  return new Set(rows.map((r) => r.username.toLowerCase()));
}

/** Build the insert row + credential for one employee, without writing. */
export function buildPortalAccount(
  employee: { id: string; fullName: string; employeeCode: string },
  taken: Set<string>,
): { row: typeof osUsers.$inferInsert; credential: IssuedCredential } {
  const username = usernameFor(employee.fullName, employee.employeeCode, taken);
  taken.add(username);
  const password = tempPassword();
  const fullName = employee.fullName.trim();

  return {
    row: {
      id: `u-${randomBytes(8).toString('hex')}`,
      username,
      fullName,
      passwordHash: hashPassword(password),
      // Portal accounts are never OS operators: role 'user' with an empty
      // permission map, so `can()` denies every OS app. It also keeps them on
      // the least-privilege branch of resolveOsActor.
      role: 'user',
      permissions: {},
      employeeId: employee.id,
    },
    credential: {
      employeeId: employee.id,
      fullName,
      employeeCode: employee.employeeCode,
      username,
      tempPassword: password,
    },
  };
}

/**
 * Give one employee a portal account. Used when a new employee is added, so
 * accounts exist "as and when they are added" rather than only in batches.
 *
 * Best-effort by design: returns null if the employee already has a live
 * account. The caller decides what to do on failure — creating an employee must
 * not fail just because account provisioning did.
 */
export async function issuePortalAccount(employee: {
  id: string;
  fullName: string;
  employeeCode: string;
}): Promise<IssuedCredential | null> {
  const existing = await db
    .select({ id: osUsers.id, employeeId: osUsers.employeeId })
    .from(osUsers)
    .where(isNull(osUsers.deletedAt));
  if (existing.some((u) => u.employeeId === employee.id)) return null;

  const taken = new Set(
    (
      await db
        .select({ username: osUsers.username })
        .from(osUsers)
        .where(isNull(osUsers.deletedAt))
    ).map((r) => r.username.toLowerCase()),
  );

  const { row, credential } = buildPortalAccount(employee, taken);
  await db.insert(osUsers).values(row);
  return credential;
}
