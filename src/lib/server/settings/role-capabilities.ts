'use server';

import { revalidatePath } from 'next/cache';

import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import { roleCapabilities } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { CAPABILITY_SET, ROLES, requireCapability, type Capability, type Role } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import {
  loadRoleCapabilityGrants,
  type RoleCapabilityGrants,
} from '@/lib/server/settings/role-capabilities-data';

/**
 * Settings → Roles & capabilities write actions. Gated on
 * `manage_role_capabilities` (partner-tier by default — the seed grants it
 * to no other role).
 *
 * The partner row is immutable: rbac short-circuits partners past every
 * check, so a revoked partner row would lie in the UI while changing
 * nothing. Reject it here as well as in the matrix UI.
 *
 * Returns the safe `{ ok } | { ok:false, message }` shape per the pattern
 * in settings/company.ts so clients can toast `message` directly.
 */

export type ActionResult = { ok: true } | { ok: false; message: string };

const ROLES_PATH = '/settings/roles';

function fail(message: string): ActionResult {
  return { ok: false, message };
}

function toErr(e: unknown): ActionResult {
  if (e instanceof AppError) return fail(e.message);
  console.error('[settings/roles] action error:', e);
  return fail('Something went wrong. Please try again.');
}

/**
 * Full matrix read for the client. The page itself reads via
 * `loadRoleCapabilityGrants` directly; this wrapper exists for client-side
 * refetches and applies the same capability gate as the writes.
 */
export async function getRoleCapabilities(): Promise<RoleCapabilityGrants> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_role_capabilities');
  return loadRoleCapabilityGrants();
}

export async function setRoleCapability(
  role: Role,
  capability: Capability,
  granted: boolean,
): Promise<ActionResult> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'manage_role_capabilities');

    // Inputs cross the action boundary untyped at runtime — re-validate
    // against the closed enums before touching the table.
    if (!(ROLES as readonly string[]).includes(role)) {
      return fail('Unknown role.');
    }
    if (role === 'partner') {
      return fail('The partner role always has every capability and cannot be edited.');
    }
    if (!CAPABILITY_SET.has(capability)) {
      return fail('Unknown capability.');
    }
    if (typeof granted !== 'boolean') {
      return fail('Grant value must be true or false.');
    }

    // Upsert: seeds cover the known (role, capability) pairs, but a
    // capability added in code before its seed migration lands must still
    // be grantable from the matrix.
    const [row] = await db
      .insert(roleCapabilities)
      .values({
        role,
        capability,
        granted,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .onConflictDoUpdate({
        target: [roleCapabilities.role, roleCapabilities.capability],
        set: { granted, updatedBy: ctx.userId },
      })
      .returning({ id: roleCapabilities.id });

    await logAudit({
      actorId: ctx.userId,
      entityType: 'role_capability',
      entityId: row!.id,
      action: granted ? 'capability_grant' : 'capability_revoke',
      changes: { role, capability, granted },
    });

    revalidatePath(ROLES_PATH);
    return { ok: true };
  } catch (e) {
    return toErr(e);
  }
}
