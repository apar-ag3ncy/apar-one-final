'use server';

import { randomBytes } from 'node:crypto';

import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import { employees, osUsers } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { hashPassword } from '@/lib/server/os-session';

/**
 * Admin-side provisioning for the employee portal: create/reset a portal
 * account for an employee and set their portal role.
 *
 * Gated on `update_employee` — the capability that already governs changing
 * someone's employment record, which this effectively is.
 *
 * Portal accounts get a stricter password floor (12 chars) than OS accounts,
 * which allow 4. OS accounts are a handful of operators behind a lock screen;
 * portal accounts are per-employee credentials on a public hostname.
 */

const MIN_PORTAL_PASSWORD = 12;

export type PortalAccountRow = {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  designation: string | null;
  portalRole: string;
  /** null when this employee has no portal account yet. */
  osUserId: string | null;
  username: string | null;
};

/** Every live employee with their portal-account state, for the admin screen. */
export async function listPortalAccounts(): Promise<PortalAccountRow[]> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_employee');

  const rows = await db
    .select({
      employeeId: employees.id,
      employeeCode: employees.employeeCode,
      fullName: employees.fullName,
      designation: employees.designation,
      portalRole: employees.portalRole,
      osUserId: osUsers.id,
      username: osUsers.username,
    })
    .from(employees)
    .leftJoin(
      osUsers,
      and(eq(osUsers.employeeId, employees.id), isNull(osUsers.deletedAt)),
    )
    .where(and(isNull(employees.deletedAt), eq(employees.isArchived, false)))
    .orderBy(asc(employees.fullName));

  return rows;
}

const CreateSchema = z.object({
  employeeId: z.string().uuid(),
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters.')
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dots, dashes or underscores only.'),
  password: z
    .string()
    .min(MIN_PORTAL_PASSWORD, `Password must be at least ${MIN_PORTAL_PASSWORD} characters.`),
});

/**
 * Create a portal account for an employee. One live account per employee is
 * enforced by the partial-unique index from 0082; we check first so the user
 * gets a sentence instead of a constraint violation.
 */
export async function createPortalAccount(input: {
  employeeId: string;
  username: string;
  password: string;
}): Promise<{ ok: true; osUserId: string } | { ok: false; error: string }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_employee');

  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the details.' };
  }
  const { employeeId, username, password } = parsed.data;

  const [employee] = await db
    .select({ id: employees.id, fullName: employees.fullName })
    .from(employees)
    .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)))
    .limit(1);
  if (!employee) return { ok: false, error: 'Employee not found.' };

  const live = await db
    .select({ id: osUsers.id, username: osUsers.username, employeeId: osUsers.employeeId })
    .from(osUsers)
    .where(isNull(osUsers.deletedAt));

  if (live.some((u) => u.employeeId === employeeId)) {
    return { ok: false, error: `${employee.fullName} already has a portal account.` };
  }
  // Username must be unique across BOTH populations — one table, one cookie.
  if (live.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return { ok: false, error: `Username "${username}" is already taken.` };
  }

  const id = `u-${randomBytes(8).toString('hex')}`;
  await db.insert(osUsers).values({
    id,
    username,
    fullName: employee.fullName,
    passwordHash: hashPassword(password),
    // OS-side role/permissions stay empty: a portal account is not an OS
    // operator, and `can()` denies everything on an empty permission map.
    role: 'user',
    permissions: {},
    employeeId,
  });

  await logAudit({
    actorId: ctx.userId,
    entityType: 'employee',
    entityId: employeeId,
    action: 'update',
    changes: { portal_account: { before: null, after: { username } } },
  });

  return { ok: true, osUserId: id };
}

/** Reset an employee's portal password. */
export async function resetPortalPassword(input: {
  employeeId: string;
  password: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_employee');

  const employeeId = z.string().uuid().safeParse(input.employeeId);
  if (!employeeId.success) return { ok: false, error: 'Employee not found.' };
  if (!input.password || input.password.length < MIN_PORTAL_PASSWORD) {
    return { ok: false, error: `Password must be at least ${MIN_PORTAL_PASSWORD} characters.` };
  }

  const updated = await db
    .update(osUsers)
    .set({ passwordHash: hashPassword(input.password) })
    .where(and(eq(osUsers.employeeId, employeeId.data), isNull(osUsers.deletedAt)))
    .returning({ id: osUsers.id });
  if (updated.length === 0) return { ok: false, error: 'No portal account for this employee.' };

  await logAudit({
    actorId: ctx.userId,
    entityType: 'employee',
    entityId: employeeId.data,
    action: 'update',
    changes: { portal_password: { before: null, after: 'reset' } },
  });
  return { ok: true };
}

/**
 * Revoke portal access. Soft-deletes the account so the employee's history
 * (and the partial-unique index) stay coherent, and a new account can be
 * issued later.
 */
export async function revokePortalAccount(input: {
  employeeId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_employee');

  const employeeId = z.string().uuid().safeParse(input.employeeId);
  if (!employeeId.success) return { ok: false, error: 'Employee not found.' };

  const updated = await db
    .update(osUsers)
    .set({ deletedAt: new Date() })
    .where(and(eq(osUsers.employeeId, employeeId.data), isNull(osUsers.deletedAt)))
    .returning({ id: osUsers.id });
  if (updated.length === 0) return { ok: false, error: 'No portal account for this employee.' };

  await logAudit({
    actorId: ctx.userId,
    entityType: 'employee',
    entityId: employeeId.data,
    action: 'update',
    changes: { portal_account: { before: 'active', after: 'revoked' } },
  });
  return { ok: true };
}

/** Set an employee's portal role ('member' | 'manager'). */
export async function setPortalRole(input: {
  employeeId: string;
  portalRole: 'member' | 'manager';
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_employee');

  const parsed = z
    .object({
      employeeId: z.string().uuid(),
      portalRole: z.enum(['member', 'manager']),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid role.' };

  const [before] = await db
    .select({ portalRole: employees.portalRole })
    .from(employees)
    .where(and(eq(employees.id, parsed.data.employeeId), isNull(employees.deletedAt)))
    .limit(1);
  if (!before) throw new AppError('not_found', 'Employee not found.');

  await db
    .update(employees)
    .set({ portalRole: parsed.data.portalRole })
    .where(eq(employees.id, parsed.data.employeeId));

  await logAudit({
    actorId: ctx.userId,
    entityType: 'employee',
    entityId: parsed.data.employeeId,
    action: 'update',
    changes: {
      portal_role: { before: before.portalRole, after: parsed.data.portalRole },
    },
  });
  return { ok: true };
}
