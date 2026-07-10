'use server';

// Server-backed OS accounts for the /os lock-screen login.
//
// Replaces the old localStorage-only auth store: accounts now live in the
// `os_users` table so a user created on one device can sign in from any other.
// Passwords are scrypt-hashed (never stored in plaintext). A signed, httpOnly
// cookie carries the session. The server actions here are the only surface the
// client store talks to.
//
// NOTE: this intentionally does NOT wire OS identity into `getActorContext()`
// — server actions still run with full dev-admin capability. The OS RBAC map
// (`permissions` / `can()`) continues to gate the OS UI client-side. Honouring
// the OS session server-side is a separate hardening step.

import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

import { cookies } from 'next/headers';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { osUsers, type OsUserRow } from '@/lib/db/schema';

const SESSION_COOKIE = 'apar_os_uid';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
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
/* Password hashing (scrypt) + cookie signing (HMAC)                          */
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

function sessionSecret(): string {
  return (
    process.env.OS_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'apar-os-fallback-secret'
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

function sanitize(row: OsUserRow): SanitizedOsUser {
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    role: row.role,
    tone: row.tone,
    permissions: (row.permissions ?? {}) as PermissionMap,
    createdAt:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
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

async function sessionUserId(): Promise<string | null> {
  const store = await cookies();
  return verifySignedSession(store.get(SESSION_COOKIE)?.value);
}

async function currentSuperAdmin(users: OsUserRow[]): Promise<boolean> {
  const id = await sessionUserId();
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
  const id = await sessionUserId();
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
  const store = await cookies();
  store.set(SESSION_COOKIE, signSession(match.id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  return { ok: true, user: sanitize(match) };
}

export async function signOutOs(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
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
    if (username.length < 3)
      return { ok: false, error: 'Username must be at least 3 characters.' };
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
