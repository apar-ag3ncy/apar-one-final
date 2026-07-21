import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { leaves } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { readTeamPolicy } from '@/lib/server/settings/team-policy-data';

/**
 * The leave-decision core, shared by two callers with DIFFERENT authorization
 * models:
 *
 *   - `approveLeave` (entities/payroll.ts) — gated on the `approve_leave`
 *     capability, for admins/managers acting through the OS.
 *   - `decideTeamLeave` (portal/leave-actions.ts) — gated on the caller being
 *     a portal MANAGER and the subject being inside their reporting subtree.
 *
 * It deliberately performs NO authorization of its own: each caller has already
 * done its own, and they are not interchangeable.
 *
 * CRITICAL: this module is `import 'server-only'`, NOT `'use server'`. Every
 * export of a 'use server' module becomes a callable RPC endpoint, so exporting
 * an ungated decision function from one would let anyone approve any leave over
 * HTTP. A plain server-only module is import-time only and has no endpoint.
 */

/** Kinds that count against the monthly paid-leave allowance. Unpaid never
 *  does; maternity/paternity are statutory and must not be blocked by it. */
export const PAID_LEAVE_KINDS = new Set(['earned', 'casual', 'sick', 'comp_off']);

export type LeaveDecision = {
  id: string;
  accept: boolean;
  /** The manager's reply → `manager_note`. Never written to `notes`. */
  managerNote?: string | null;
  /** Whether an approved leave is paid. Ignored on reject. */
  isPaid?: boolean;
  /** Deciding manager, as an employees.id. */
  decidedByEmployeeId?: string | null;
  /** users.id for the created_by/updated_by columns. */
  actorUserId: string;
};

export async function applyLeaveDecision(args: LeaveDecision): Promise<void> {
  // Guard for accept AND reject: a soft-deleted leave must not be decidable,
  // and an already-decided one must not be silently re-decided (which would
  // overwrite decidedBy/decidedAt).
  const [current] = await db
    .select({ id: leaves.id, status: leaves.status })
    .from(leaves)
    .where(and(eq(leaves.id, args.id), isNull(leaves.deletedAt)))
    .limit(1);
  if (!current) throw new AppError('not_found', `leave ${args.id} not found`);
  if (current.status !== 'applied') {
    throw new AppError(
      'validation',
      `This leave is already ${current.status}. Only a pending request can be decided.`,
    );
  }

  // Monthly paid-leave cap (Settings → Team → Team policies). Only bites when
  // the leave is actually being granted AS PAID — approving the same request
  // as unpaid is always allowed.
  if (args.accept) {
    const [leave] = await db.select().from(leaves).where(eq(leaves.id, args.id)).limit(1);
    if (!leave) throw new AppError('not_found', `leave ${args.id} not found`);

    const treatAsPaid = args.isPaid ?? PAID_LEAVE_KINDS.has(leave.kind);
    if (treatAsPaid && PAID_LEAVE_KINDS.has(leave.kind)) {
      const { paidLeavesPerMonth } = await readTeamPolicy();
      const monthStart = `${leave.fromDate.slice(0, 7)}-01`;
      const [y, m] = leave.fromDate.split('-').map(Number);
      const monthEnd = `${leave.fromDate.slice(0, 7)}-${String(
        new Date(Date.UTC(y!, m!, 0)).getUTCDate(),
      ).padStart(2, '0')}`;

      const approvedRows = await db
        .select({ kind: leaves.kind, days: leaves.days, isPaid: leaves.isPaid })
        .from(leaves)
        .where(
          and(
            eq(leaves.employeeId, leave.employeeId),
            eq(leaves.status, 'approved'),
            sql`${leaves.fromDate} >= ${monthStart}`,
            sql`${leaves.fromDate} <= ${monthEnd}`,
            isNull(leaves.deletedAt),
          ),
        );

      const alreadyGranted = approvedRows
        // A leave explicitly approved as UNPAID must not consume the paid
        // allowance, even though its kind is a paid one.
        .filter((r) => PAID_LEAVE_KINDS.has(r.kind) && r.isPaid !== false)
        .reduce((s, r) => s + Number.parseFloat(r.days), 0);
      const requested = Number.parseFloat(leave.days);

      if (alreadyGranted + requested > paidLeavesPerMonth) {
        const monthLabel = new Date(`${monthStart}T00:00:00Z`).toLocaleDateString('en-IN', {
          month: 'long',
          year: 'numeric',
        });
        throw new AppError(
          'validation',
          `Only ${paidLeavesPerMonth} paid-leave day${paidLeavesPerMonth === 1 ? '' : 's'} can be granted per month — ${alreadyGranted} already granted in ${monthLabel} and this leave adds ${requested}. Grant it as Unpaid, or raise the allowance in Settings → Team.`,
        );
      }
    }
  }

  await db
    .update(leaves)
    .set({
      status: args.accept ? 'approved' : 'rejected',
      approvedBy: args.actorUserId,
      approvedAt: new Date(),
      // `notes` is deliberately NOT touched — it is the applicant's reason.
      managerNote: args.managerNote ?? null,
      decidedByEmployeeId: args.decidedByEmployeeId ?? null,
      decidedAt: new Date(),
      isPaid: args.accept ? (args.isPaid ?? null) : null,
      updatedBy: args.actorUserId,
    })
    .where(and(eq(leaves.id, args.id), isNull(leaves.deletedAt)));
}
