'use server';

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { employees, leaves } from '@/lib/db/schema';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { applyLeaveDecision } from '@/lib/server/entities/leave-decision';

/**
 * The OS-side pending-leave queue for admins.
 *
 * Employees whose manager is not appointed "go under admin", and admins work in
 * the OS rather than the portal — so this is where those requests surface.
 * Admins see ALL pending leave (they oversee everything), with the ones that
 * have no manager flagged, because those are the ones nobody else will action.
 *
 * Gated on `approve_leave`, the same capability the OS has always used for leave
 * decisions. The portal's manager queue is a separate surface authorized by
 * reporting subtree instead — see server/portal/leave.ts.
 */

export type PendingLeaveRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  managerName: string | null;
  kind: string;
  fromDate: string;
  toDate: string;
  days: string;
  notes: string | null;
  appliedAt: string;
  /** No manager appointed ⇒ this one is admin's to action. */
  hasNoManager: boolean;
};

export async function listPendingLeave(): Promise<PendingLeaveRow[]> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'approve_leave');

  // The manager's NAME is resolved in a second query rather than an aliased
  // self-join: adding `aliasedTable(employees, …)` to a SELECT this wide tips
  // Drizzle's type inference over its complexity limit and silently degrades
  // the whole row type to `never` (the errors then surface at the use site,
  // not the query). Same trap as the portal task board.
  const rows = await db
    .select({
      id: leaves.id,
      employeeId: leaves.employeeId,
      employeeName: employees.fullName,
      employeeCode: employees.employeeCode,
      reportsToEmployeeId: employees.reportsToEmployeeId,
      kind: leaves.kind,
      fromDate: leaves.fromDate,
      toDate: leaves.toDate,
      days: leaves.days,
      notes: leaves.notes,
      appliedAt: leaves.appliedAt,
    })
    .from(leaves)
    .innerJoin(employees, eq(employees.id, leaves.employeeId))
    .where(and(eq(leaves.status, 'applied'), isNull(leaves.deletedAt)))
    .orderBy(asc(leaves.fromDate));

  const managerIds = [
    ...new Set(rows.map((r) => r.reportsToEmployeeId).filter((id): id is string => !!id)),
  ];
  const managerNameById = new Map<string, string>();
  if (managerIds.length > 0) {
    const managers = await db
      .select({ id: employees.id, fullName: employees.fullName })
      .from(employees)
      .where(inArray(employees.id, managerIds));
    for (const m of managers) managerNameById.set(m.id, m.fullName);
  }

  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: r.employeeName,
    employeeCode: r.employeeCode,
    managerName: r.reportsToEmployeeId
      ? (managerNameById.get(r.reportsToEmployeeId) ?? null)
      : null,
    kind: r.kind,
    fromDate: r.fromDate,
    toDate: r.toDate,
    days: r.days,
    notes: r.notes,
    appliedAt: r.appliedAt.toISOString(),
    hasNoManager: !r.reportsToEmployeeId,
  }));
}

/**
 * Decide a pending leave from the OS. Capability-gated (`approve_leave` inside
 * applyLeaveDecision's caller contract), and records the decision through the
 * same shared core the portal uses, so the monthly paid-leave cap and the
 * pending/soft-delete guards apply identically on both surfaces.
 */
export async function decidePendingLeave(input: {
  id: string;
  accept: boolean;
  managerNote?: string | null;
  isPaid?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'approve_leave');

  try {
    await applyLeaveDecision({
      id: input.id,
      accept: input.accept,
      managerNote: input.managerNote?.trim() || null,
      isPaid: input.accept ? (input.isPaid ?? true) : undefined,
      // An OS admin is not necessarily an employee, so there may be no employee
      // uuid to attribute this to; approvedBy/updatedBy still record the actor.
      decidedByEmployeeId: null,
      actorUserId: ctx.userId,
    });
  } catch (e) {
    // The paid-leave cap surfaces here with its numbers spelled out.
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save that decision.' };
  }
  return { ok: true };
}
