'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { employees, entityActivityLog } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { getActorContext } from '@/lib/server/actor';
import { requireCapability } from '@/lib/rbac';

/**
 * Achievement curation for the employee profile / personal dashboard
 * (SPEC-AMENDMENT-001 §8.4). A partner/admin marks a noteworthy event on an
 * employee — "Led the Nykaa launch", "5 years at APAR" — which surfaces on
 * the employee's dashboard.
 *
 * Backed by `entity_activity_log` with `is_achievement=true` and the existing
 * `achievement_added` event kind. That table is **append-only** — RLS enables
 * insert + select for `service_role` and REVOKEs UPDATE/DELETE/TRUNCATE (see
 * drizzle/0005_phase2_rls.sql). Achievements are therefore **add-only**: there
 * is no delete/edit path, so no `deleteEmployeeAchievement` is provided.
 */

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const AddSchema = z.object({
  employeeId: z.string().uuid(),
  summary: z.string().trim().min(1, 'An achievement needs a short summary.').max(500),
  occurredOn: z.string().regex(dateRegex, 'occurredOn must be YYYY-MM-DD').nullable().optional(),
});

export type AddEmployeeAchievementInput = z.input<typeof AddSchema>;

/**
 * Record an achievement against an employee. Writes a single append-only
 * `entity_activity_log` row (kind `achievement_added`, `is_achievement=true`).
 * Returns the new row id.
 */
export async function addEmployeeAchievement(input: {
  employeeId: string;
  summary: string;
  occurredOn?: string | null;
}): Promise<{ id: string }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'mark_achievement');
  const parsed = AddSchema.parse(input);

  // Guard against dangling achievements — the employee must exist and be live.
  const [emp] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.id, parsed.employeeId), isNull(employees.deletedAt)))
    .limit(1);
  if (!emp) {
    throw new AppError('not_found', `Employee ${parsed.employeeId} not found.`);
  }

  // Direct insert (rather than logActivity) so we can return the row id.
  // INSERT is the only write RLS permits on this append-only table.
  const [row] = await db
    .insert(entityActivityLog)
    .values({
      entityType: 'employee',
      entityId: parsed.employeeId,
      actorId: ctx.userId,
      kind: 'achievement_added',
      summary: parsed.summary,
      payload: { occurredOn: parsed.occurredOn ?? null },
      isAchievement: true,
    })
    .returning({ id: entityActivityLog.id });
  if (!row) throw new AppError('internal', 'achievement insert returned no row');

  return { id: row.id };
}
