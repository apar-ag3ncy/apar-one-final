'use server';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema/users';
import { requireCapability, type Role } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

/**
 * Team management for the OS Settings → Team section. Operates on the REAL
 * Postgres `users` table + RBAC roles (not the OS demo localStorage store).
 * Reads/writes require `manage_users`.
 *
 * Guardrails baked into every mutation:
 *   - the `partner` role is never assignable, and a partner user is never
 *     modifiable from here (provisioned out-of-band);
 *   - you cannot change or deactivate your OWN account (no self-lockout);
 *   - the dev-admin sentinel (00000000-…) is protected because it backs FKs
 *     such as transactions.posted_by.
 *
 * Soft-deactivation reuses `users.deletedAt` (no new column / migration):
 * `active = deletedAt === null`.
 */

const DEV_ADMIN_USER_ID = '00000000-0000-0000-0000-000000000000';

const ASSIGNABLE_ROLES = ['admin', 'manager', 'accountant', 'employee', 'viewer'] as const;
const RoleInputSchema = z.enum(ASSIGNABLE_ROLES);

export type TeamMember = {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  /** false when the row is soft-deactivated (deletedAt set). */
  active: boolean;
};

export type TeamMutationResult = { ok: true } | { ok: false; message: string };

/** All users (including deactivated ones, so they can be reactivated). */
export async function listTeamMembers(): Promise<readonly TeamMember[]> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_users');
  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .orderBy(users.fullName);
  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    email: r.email,
    role: r.role,
    active: r.deletedAt === null,
  }));
}

/** Load a target user's id + current role, or null if missing. */
async function loadTarget(userId: string): Promise<{ role: Role } | null> {
  const rows = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

/** Change another user's role. Cannot target self / partner / the sentinel. */
export async function setUserRole(userId: string, role: string): Promise<TeamMutationResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_users');

  const parsedRole = RoleInputSchema.safeParse(role);
  if (!parsedRole.success) {
    return { ok: false, message: 'That role cannot be assigned.' };
  }
  if (userId === ctx.userId) {
    return { ok: false, message: 'You cannot change your own role.' };
  }
  if (userId === DEV_ADMIN_USER_ID) {
    return { ok: false, message: 'The system account cannot be modified.' };
  }

  const target = await loadTarget(userId);
  if (!target) return { ok: false, message: 'User not found.' };
  if (target.role === 'partner') {
    return { ok: false, message: 'The partner account cannot be modified.' };
  }
  if (target.role === parsedRole.data) return { ok: true };

  const updated = await db
    .update(users)
    .set({ role: parsedRole.data })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (updated.length === 0) return { ok: false, message: 'User not found.' };

  await logAudit({
    actorId: ctx.userId,
    entityType: 'users',
    entityId: userId,
    action: 'update',
    changes: { role: { before: target.role, after: parsedRole.data } },
  });
  return { ok: true };
}

/** Activate / deactivate a user (soft, via deletedAt). Cannot target self / partner / sentinel. */
export async function setUserActive(userId: string, active: boolean): Promise<TeamMutationResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_users');

  if (userId === ctx.userId && !active) {
    return { ok: false, message: 'You cannot deactivate your own account.' };
  }
  if (userId === DEV_ADMIN_USER_ID && !active) {
    return { ok: false, message: 'The system account cannot be deactivated.' };
  }

  const target = await loadTarget(userId);
  if (!target) return { ok: false, message: 'User not found.' };
  if (target.role === 'partner' && !active) {
    return { ok: false, message: 'The partner account cannot be deactivated.' };
  }

  const updated = await db
    .update(users)
    .set({ deletedAt: active ? null : new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (updated.length === 0) return { ok: false, message: 'User not found.' };

  await logAudit({
    actorId: ctx.userId,
    entityType: 'users',
    entityId: userId,
    action: 'update',
    changes: { active: { before: !active, after: active } },
  });
  return { ok: true };
}
