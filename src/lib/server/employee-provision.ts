import 'server-only';

import { randomBytes, scryptSync } from 'node:crypto';

import { isNull } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';

/**
 * Portal-account provisioning for employees, shared by the admin backfill
 * action and by `createEmployee` (so a new hire gets an account the moment
 * they are added).
 *
 * Plain `import 'server-only'`, NOT 'use server': every export of a 'use server'
 * module becomes a callable RPC endpoint, and account creation must only happen
 * behind a capability/operator check in one of the callers.
 *
 * Login model (main): sign-in is by `login_username` OR `work_email`, verified
 * against the scrypt `password_hash`. Most employees have no work email, so a
 * default account gives them a generated username + a temp password.
 */

/** Same scrypt scheme as employee-auth.ts / os-auth.ts. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/**
 * A username from a person's name: first name, lowercased, non-alphanumerics
 * stripped. Collisions take a numeric suffix, then fall back to the employee
 * code — the roster genuinely contains repeated names (two "Yesha Shah"), so
 * uniqueness cannot be assumed. `taken` must hold BOTH existing login usernames
 * and work-email local-parts to avoid a username colliding with an email login.
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
 * admin to hand over, stored only as a scrypt hash. Look-alike characters
 * (0/O, 1/l/I) are excluded because these get read aloud and typed on phones.
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
 * Login ids already in use across all live employees — both `login_username`
 * and the local-part of `work_email` (so a generated username can't collide
 * with an email login). Case-insensitive.
 */
export async function takenLoginIds(): Promise<Set<string>> {
  const rows = await db
    .select({ loginUsername: employees.loginUsername, workEmail: employees.workEmail })
    .from(employees)
    .where(isNull(employees.deletedAt));
  const taken = new Set<string>();
  for (const r of rows) {
    if (r.loginUsername) taken.add(r.loginUsername.toLowerCase());
    if (r.workEmail) {
      taken.add(r.workEmail.toLowerCase());
      const local = r.workEmail.split('@')[0]?.toLowerCase();
      if (local) taken.add(local);
    }
  }
  return taken;
}

/**
 * Build the update patch + credential for one employee, without writing. The
 * caller owns the DB write so it can batch. `taken` is mutated to reserve the
 * chosen username.
 */
export function buildEmployeeAccount(
  employee: { id: string; fullName: string; employeeCode: string },
  taken: Set<string>,
): {
  patch: { loginUsername: string; passwordHash: string };
  credential: IssuedCredential;
} {
  const username = usernameFor(employee.fullName, employee.employeeCode, taken);
  taken.add(username);
  const password = tempPassword();
  return {
    patch: { loginUsername: username, passwordHash: hashPassword(password) },
    credential: {
      employeeId: employee.id,
      fullName: employee.fullName.trim(),
      employeeCode: employee.employeeCode,
      username,
      tempPassword: password,
    },
  };
}
