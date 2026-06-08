'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema/users';
import { AppError } from '@/lib/errors';
import { CAPABILITIES, CAPABILITY_LABELS, type Capability, type Role } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { listAuditLog, type AuditLogRow } from '@/lib/server/audit/queries';

/**
 * Self-service account actions for the OS Settings → Account / Security
 * sections. Everything is scoped to the *current* authenticated user
 * (getActorContext().userId), so no `manage_users` capability is required —
 * a user may always read and edit their own profile and view their own
 * recent activity.
 *
 * NOTE (email is read-only here): `public.users.email` mirrors
 * `auth.users.email` via a one-way INSERT trigger (migration 0006). There is
 * no reverse sync, and the Drizzle client writes `public` only — updating the
 * email here would silently diverge from the identity the user actually signs
 * in with. Email editing therefore belongs to the (future) real login flow;
 * we expose it read-only for now.
 */

function zodErrorsToPathMap(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.');
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

export type MyProfile = {
  id: string;
  fullName: string;
  email: string;
  role: Role;
};

/** The current user's own profile row. */
export async function getMyProfile(): Promise<MyProfile> {
  const ctx = await getActorContext();
  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .where(and(eq(users.id, ctx.userId), isNull(users.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AppError('not_found', 'Your profile could not be found.');
  return row;
}

const UpdateMyProfileSchema = z.object({
  fullName: z.string().trim().min(1, 'Name is required.').max(200, 'Name is too long.'),
});
export type UpdateMyProfileInput = z.input<typeof UpdateMyProfileSchema>;

export type UpdateMyProfileResult =
  | { ok: true }
  | { ok: false; message: string; errors: Record<string, string> };

/** Update the current user's own display name. Email/role are not editable here. */
export async function updateMyProfile(input: UpdateMyProfileInput): Promise<UpdateMyProfileResult> {
  const ctx = await getActorContext();

  const parsed = UpdateMyProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Please fix the highlighted fields.',
      errors: zodErrorsToPathMap(parsed.error),
    };
  }
  const { fullName } = parsed.data;

  // Capture the "before" value so the manual audit row carries a real diff.
  // (The auto-trigger on `users` records an actor-NULL row because Drizzle
  // writes bypass Supabase auth.uid(); this manual row is the attributable one.)
  const before = await db
    .select({ fullName: users.fullName })
    .from(users)
    .where(and(eq(users.id, ctx.userId), isNull(users.deletedAt)))
    .limit(1);
  if (!before[0]) return { ok: false, message: 'Your profile could not be found.', errors: {} };

  // No `updatedBy` — the users table has no audit columns.
  const result = await db
    .update(users)
    .set({ fullName })
    .where(and(eq(users.id, ctx.userId), isNull(users.deletedAt)))
    .returning({ id: users.id });
  if (result.length === 0) {
    return { ok: false, message: 'Your profile could not be found.', errors: {} };
  }

  await logAudit({
    actorId: ctx.userId,
    entityType: 'users',
    entityId: ctx.userId,
    action: 'update',
    changes: { fullName: { before: before[0].fullName, after: fullName } },
  });

  return { ok: true };
}

export type MySecurity = {
  role: Role;
  capabilities: readonly { key: Capability; label: string }[];
  recentActivity: readonly AuditLogRow[];
};

/**
 * The current user's security overview: role, the human-readable list of
 * capabilities they hold, and their last ~20 audit entries. Strictly
 * self-scoped (actorId === ctx.userId), so it is capability-free — a user can
 * always review their own activity even without `view_audit_log`.
 */
export async function getMySecurity(): Promise<MySecurity> {
  const ctx = await getActorContext();
  const capabilities = CAPABILITIES.filter((c) => ctx.capabilities.has(c)).map((key) => ({
    key,
    label: CAPABILITY_LABELS[key],
  }));
  const recentActivity = await listAuditLog({ actorId: ctx.userId, limit: 20 });
  return { role: ctx.role, capabilities, recentActivity };
}
