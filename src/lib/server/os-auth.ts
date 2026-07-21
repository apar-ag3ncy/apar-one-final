'use server';

// Server-backed OS accounts for the /os lock-screen login.
//
// Replaces the old localStorage-only auth store: accounts now live in the
// `os_users` table so a user created on one device can sign in from any other.
// Passwords are scrypt-hashed (never stored in plaintext). A signed, httpOnly
// cookie carries the session. The server actions here are the only surface the
// client store talks to.
//
// The OS session IS now honoured server-side: `getActorContext()` resolves this
// cookie into a real actor context (see server/actor.ts), and the employee
// portal resolves it into an employee via server/portal/session.ts. The OS RBAC
// map (`permissions` / `can()`) still gates the OS UI client-side on top.
//
// The crypto + cookie primitives live in `server/os-session.ts` because this
// file is 'use server' and may export ONLY async functions.

import { randomBytes } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { osUsers, type OsUserRow } from '@/lib/db/schema';
import {
  clearOsSessionCookie,
  hashPassword,
  readOsSessionUserId,
  setOsSessionCookie,
  verifyPassword,
} from '@/lib/server/os-session';

const SUPER_ADMIN_ID = 'super-admin';
const SUPER_ADMIN_DEFAULT_USERNAME = 'apar';
const SUPER_ADMIN_DEFAULT_PASSWORD = 'apar2026';

type AppPermission = { view: boolean; edit: boolean; delete: boolean };
type PermissionMap = Record<string, AppPermission>;

type SanitizedOsUser = {
  id: string;
  username: string;
  fullName: string;
  role: string;
  tone: string;
  permissions: PermissionMap;
  createdAt: string;
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function sanitize(row: OsUserRow): SanitizedOsUser {
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    role: row.role,
    tone: row.tone,
    permissions: (row.permissions ?? {}) as PermissionMap,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

// One-shot per server process: guarantee the built-in super admin exists so
// the operator can never be locked out (mirrors ensureDevAdmin in actor.ts).
// ON CONFLICT DO NOTHING means a changed super-admin password is preserved.
let superAdminEnsured = false;
async function ensureOsSuperAdmin(): Promise<void> {
  if (superAdminEnsured) return;
  try {
    const hash = hashPassword(SUPER_ADMIN_DEFAULT_PASSWORD);
    await db.execute(sql`
      INSERT INTO "os_users" (id, username, full_name, password_hash, role, tone, permissions)
      VALUES (
        ${SUPER_ADMIN_ID}, ${SUPER_ADMIN_DEFAULT_USERNAME}, 'Apar Admin',
        ${hash}, 'super_admin', '#E63A1F', '{}'::jsonb
      )
      ON CONFLICT (id) DO NOTHING
    `);
    superAdminEnsured = true;
  } catch {
    // Best-effort — mark ensured so we don't hammer it every call.
    superAdminEnsured = true;
  }
}

async function liveUsers(): Promise<OsUserRow[]> {
  const rows = await db.select().from(osUsers).where(isNull(osUsers.deletedAt));
  // Super admin first, then oldest → newest.
  return rows.sort((a, b) => {
    if (a.role === 'super_admin' && b.role !== 'super_admin') return -1;
    if (b.role === 'super_admin' && a.role !== 'super_admin') return 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

async function currentSuperAdmin(users: OsUserRow[]): Promise<boolean> {
  const id = await readOsSessionUserId();
  if (!id) return false;
  const me = users.find((u) => u.id === id);
  return me?.role === 'super_admin';
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

/** Lock-screen / admin-console bootstrap: all users + the resolved session. */
export async function bootstrapOsAuth(): Promise<{
  users: SanitizedOsUser[];
  currentUser: SanitizedOsUser | null;
}> {
  await ensureOsSuperAdmin();
  const rows = await liveUsers();
  const id = await readOsSessionUserId();
  const me = id ? (rows.find((u) => u.id === id) ?? null) : null;
  return { users: rows.map(sanitize), currentUser: me ? sanitize(me) : null };
}

export async function signInOs(
  username: string,
  password: string,
): Promise<{ ok: true; user: SanitizedOsUser } | { ok: false; error: string }> {
  await ensureOsSuperAdmin();
  const uname = username.trim().toLowerCase();
  const rows = await liveUsers();
  const match = rows.find((u) => u.username.toLowerCase() === uname);
  if (!match || !verifyPassword(password, match.passwordHash)) {
    return { ok: false, error: 'Incorrect username or password.' };
  }
  await setOsSessionCookie(match.id);
  return { ok: true, user: sanitize(match) };
}

export async function signOutOs(): Promise<void> {
  await clearOsSessionCookie();
}

export async function createOsUser(input: {
  username: string;
  fullName: string;
  password: string;
  tone?: string;
  permissions?: PermissionMap;
}): Promise<{ ok: true; user: SanitizedOsUser } | { ok: false; error: string }> {
  const rows = await liveUsers();
  if (!(await currentSuperAdmin(rows))) return { ok: false, error: 'Not authorized.' };

  const username = input.username.trim();
  if (username.length < 3) return { ok: false, error: 'Username must be at least 3 characters.' };
  if (!input.password || input.password.length < 4)
    return { ok: false, error: 'Password must be at least 4 characters.' };
  if (rows.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return { ok: false, error: `Username "${username}" is already taken.` };
  }

  const id = `u-${randomBytes(8).toString('hex')}`;
  const [row] = await db
    .insert(osUsers)
    .values({
      id,
      username,
      fullName: input.fullName.trim() || username,
      passwordHash: hashPassword(input.password),
      role: 'admin',
      tone: input.tone ?? '#B5391E',
      permissions: (input.permissions ?? {}) as PermissionMap,
    })
    .returning();
  return { ok: true, user: sanitize(row!) };
}

export async function updateOsUser(
  id: string,
  patch: { fullName?: string; username?: string; password?: string; tone?: string },
): Promise<{ ok: true; user: SanitizedOsUser } | { ok: false; error: string }> {
  const rows = await liveUsers();
  if (!(await currentSuperAdmin(rows))) return { ok: false, error: 'Not authorized.' };

  const target = rows.find((u) => u.id === id);
  if (!target) return { ok: false, error: 'User not found.' };

  const set: Partial<typeof osUsers.$inferInsert> = {};

  if (patch.fullName !== undefined) {
    const fullName = patch.fullName.trim();
    if (!fullName) return { ok: false, error: 'Name is required.' };
    set.fullName = fullName;
  }
  // Username edits are only allowed on the super-admin row (the only card that
  // exposes it), and must stay unique.
  if (patch.username !== undefined && id === SUPER_ADMIN_ID) {
    const username = patch.username.trim();
    if (username.length < 3) return { ok: false, error: 'Username must be at least 3 characters.' };
    if (rows.some((u) => u.id !== id && u.username.toLowerCase() === username.toLowerCase())) {
      return { ok: false, error: `Username "${username}" is already taken.` };
    }
    set.username = username;
  }
  if (patch.password !== undefined && patch.password !== '') {
    if (patch.password.length < 4)
      return { ok: false, error: 'Password must be at least 4 characters.' };
    set.passwordHash = hashPassword(patch.password);
  }
  if (patch.tone !== undefined) set.tone = patch.tone;

  if (Object.keys(set).length === 0) return { ok: true, user: sanitize(target) };

  const [row] = await db.update(osUsers).set(set).where(eq(osUsers.id, id)).returning();
  return { ok: true, user: sanitize(row!) };
}

export async function deleteOsUser(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (id === SUPER_ADMIN_ID) return { ok: false, error: 'The super admin cannot be deleted.' };
  const rows = await liveUsers();
  if (!(await currentSuperAdmin(rows))) return { ok: false, error: 'Not authorized.' };
  await db.delete(osUsers).where(eq(osUsers.id, id));
  return { ok: true };
}

export async function setOsPermissions(
  id: string,
  permissions: PermissionMap,
): Promise<{ ok: true; user: SanitizedOsUser } | { ok: false; error: string }> {
  const rows = await liveUsers();
  if (!(await currentSuperAdmin(rows))) return { ok: false, error: 'Not authorized.' };
  const [row] = await db
    .update(osUsers)
    .set({ permissions })
    .where(and(eq(osUsers.id, id), isNull(osUsers.deletedAt)))
    .returning();
  if (!row) return { ok: false, error: 'User not found.' };
  return { ok: true, user: sanitize(row) };
}
