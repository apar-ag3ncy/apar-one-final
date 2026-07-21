'use server';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { leaves } from '@/lib/db/schema';
import { applyLeaveDecision } from '@/lib/server/entities/leave-decision';
import { getActorContext } from '@/lib/server/actor';
import { canDecideFor } from '@/lib/server/portal/leave';
import { requirePortalEmployee, requirePortalManager } from '@/lib/server/portal/session';

/**
 * Leave writes from the portal.
 *
 * `applyLeave` in entities/payroll.ts is NOT reused: it takes `employeeId` from
 * caller input with no capability check and no ownership check, so an employee
 * could file leave in a colleague's name. Here the employee id always comes
 * from the session.
 */

const KindEnum = z.enum([
  'earned',
  'casual',
  'sick',
  'unpaid',
  'comp_off',
  'maternity',
  'paternity',
]);

const ApplySchema = z
  .object({
    kind: KindEnum,
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a start date.'),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick an end date.'),
    days: z
      .string()
      .regex(/^\d+(\.\d)?$/, 'Days must be a number (half-days allowed, e.g. 1.5).'),
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((v) => v.fromDate <= v.toDate, {
    message: 'The end date cannot be before the start date.',
    path: ['toDate'],
  })
  .refine((v) => Number.parseFloat(v.days) > 0, {
    message: 'Days must be more than zero.',
    path: ['days'],
  });

export async function applyMyLeave(input: {
  kind: string;
  fromDate: string;
  toDate: string;
  days: string;
  notes?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const me = await requirePortalEmployee();
  const ctx = await getActorContext();

  const parsed = ApplySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the dates.' };
  }
  const { kind, fromDate, toDate, days, notes } = parsed.data;

  // `days` is free text in the DB and nothing validates it against the span,
  // so a 10-day range could be filed as 0.5 days. Bound it here.
  const spanDays =
    Math.round(
      (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000,
    ) + 1;
  if (Number.parseFloat(days) > spanDays) {
    return {
      ok: false,
      error: `That is ${days} days across a ${spanDays}-day range. Check the dates.`,
    };
  }

  // applyLeave does no overlap check, so an employee could otherwise queue
  // several overlapping requests and only discover the clash at approval.
  const [clash] = await db
    .select({ id: leaves.id, fromDate: leaves.fromDate, toDate: leaves.toDate })
    .from(leaves)
    .where(
      and(
        eq(leaves.employeeId, me.employeeId),
        isNull(leaves.deletedAt),
        sql`${leaves.status} in ('applied','approved')`,
        sql`${leaves.fromDate} <= ${toDate}`,
        sql`${leaves.toDate} >= ${fromDate}`,
      ),
    )
    .limit(1);
  if (clash) {
    return {
      ok: false,
      error: `You already have leave from ${clash.fromDate} to ${clash.toDate} that overlaps these dates.`,
    };
  }

  const [row] = await db
    .insert(leaves)
    .values({
      employeeId: me.employeeId,
      kind,
      fromDate,
      toDate,
      days,
      status: 'applied',
      notes: notes?.trim() || null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning({ id: leaves.id });

  if (!row) return { ok: false, error: 'Could not file that leave. Try again.' };
  return { ok: true, id: row.id };
}

/**
 * Withdraw a pending application. `leave_status` has always had 'cancelled'
 * but no code path ever set it, so an employee could not take a request back.
 */
export async function cancelMyLeave(input: {
  id: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requirePortalEmployee();
  const ctx = await getActorContext();

  const id = z.string().uuid().safeParse(input.id);
  if (!id.success) return { ok: false, error: 'Leave not found.' };

  // Ownership + "still pending" are both in the WHERE clause, so a decided or
  // someone else's leave simply matches nothing.
  const updated = await db
    .update(leaves)
    .set({ status: 'cancelled', updatedBy: ctx.userId })
    .where(
      and(
        eq(leaves.id, id.data),
        eq(leaves.employeeId, me.employeeId),
        eq(leaves.status, 'applied'),
        isNull(leaves.deletedAt),
      ),
    )
    .returning({ id: leaves.id });

  if (updated.length === 0) {
    return { ok: false, error: 'Only your own pending requests can be withdrawn.' };
  }
  return { ok: true };
}

/**
 * Manager decision on a report's leave.
 *
 * Authorizes by REPORTING SUBTREE — plus, for an admin, anyone with no manager
 * appointed — then calls the shared decision core so the monthly paid-leave cap
 * (Settings → Team) still applies.
 *
 * It deliberately does NOT go through `approveLeave`, which gates on the
 * `approve_leave` capability: a portal employee resolves to the least-privileged
 * 'employee' role and does not hold it. Granting that capability to the employee
 * role would be worse than useless — it is FLAT, so every employee could then
 * decide anyone's leave through the OS action. Subtree membership is the right
 * boundary here, and `applyLeaveDecision` lives in a plain server-only module so
 * it is not itself reachable as an endpoint.
 */
export async function decideTeamLeave(input: {
  id: string;
  accept: boolean;
  managerNote?: string | null;
  /** Only meaningful when accepting. */
  isPaid?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requirePortalManager();

  const parsed = z
    .object({
      id: z.string().uuid(),
      accept: z.boolean(),
      managerNote: z.string().trim().max(1000).optional().nullable(),
      isPaid: z.boolean().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the decision details.' };

  const [leave] = await db
    .select({ id: leaves.id, employeeId: leaves.employeeId, status: leaves.status })
    .from(leaves)
    .where(and(eq(leaves.id, parsed.data.id), isNull(leaves.deletedAt)))
    .limit(1);
  if (!leave) return { ok: false, error: 'That request no longer exists.' };

  // Inside their subtree, or — for an admin — anyone with no manager appointed.
  if (!(await canDecideFor(leave.employeeId))) {
    return { ok: false, error: 'That request is not yours to review.' };
  }
  if (leave.status !== 'applied') {
    return { ok: false, error: `That request is already ${leave.status}.` };
  }

  const ctx = await getActorContext();
  try {
    await applyLeaveDecision({
      id: parsed.data.id,
      accept: parsed.data.accept,
      managerNote: parsed.data.managerNote?.trim() || null,
      isPaid: parsed.data.accept ? (parsed.data.isPaid ?? true) : undefined,
      decidedByEmployeeId: me.employeeId,
      actorUserId: ctx.userId,
    });
  } catch (e) {
    // The paid-leave cap surfaces here as a validation error with the numbers
    // spelled out — show it rather than a generic failure.
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save that decision.' };
  }

  return { ok: true };
}
