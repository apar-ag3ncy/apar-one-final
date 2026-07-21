import 'server-only';

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { employees, leaves } from '@/lib/db/schema';
import { readTeamPolicy } from '@/lib/server/settings/team-policy-data';
import { todayIST } from '@/lib/ist-date';

import { requirePortalEmployee, requirePortalManager } from './session';

/**
 * Leave for the portal: the employee's own history, and — for managers — a
 * pending queue over their reporting subtree.
 *
 * Everything is scoped to the session. `listEmployeeLeaves` takes a
 * caller-supplied employeeId with no ownership check, so it is not reused for
 * the "my leaves" path.
 */

/** Kinds that count against the monthly paid-leave allowance (mirrors payroll.ts). */
const PAID_LEAVE_KINDS = new Set(['earned', 'casual', 'sick', 'comp_off']);

export const LEAVE_KINDS = [
  { value: 'casual', label: 'Casual' },
  { value: 'sick', label: 'Sick' },
  { value: 'earned', label: 'Earned' },
  { value: 'comp_off', label: 'Comp-off' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'maternity', label: 'Maternity' },
  { value: 'paternity', label: 'Paternity' },
] as const;

export type MyLeave = {
  id: string;
  kind: string;
  fromDate: string;
  toDate: string;
  days: string;
  status: string;
  /** The applicant's own reason. */
  notes: string | null;
  /** The manager's reply. */
  managerNote: string | null;
  decidedAt: string | null;
  /** Stored decision; null on legacy rows, where it derives from `kind`. */
  isPaid: boolean | null;
  decidedByName: string | null;
};

/**
 * Paid/unpaid to SHOW for a leave. Prefers the stored decision (0083) and
 * falls back to deriving from kind for rows decided before that existed.
 */
export function effectivePaid(kind: string, isPaid: boolean | null): boolean {
  if (isPaid !== null) return isPaid;
  return PAID_LEAVE_KINDS.has(kind);
}

export async function getMyLeaves(limit = 50): Promise<MyLeave[]> {
  const me = await requirePortalEmployee();
  const decider = sql<string | null>`(
    select e2.full_name from employees e2 where e2.id = ${leaves.decidedByEmployeeId}
  )`;

  const rows = await db
    .select({
      id: leaves.id,
      kind: leaves.kind,
      fromDate: leaves.fromDate,
      toDate: leaves.toDate,
      days: leaves.days,
      status: leaves.status,
      notes: leaves.notes,
      managerNote: leaves.managerNote,
      decidedAt: leaves.decidedAt,
      isPaid: leaves.isPaid,
      decidedByName: decider,
    })
    .from(leaves)
    .where(and(eq(leaves.employeeId, me.employeeId), isNull(leaves.deletedAt)))
    .orderBy(desc(leaves.fromDate))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
  }));
}

/** Paid-leave days already granted to me this calendar month, and the cap. */
export async function getMyPaidLeaveAllowance(): Promise<{
  perMonth: number;
  usedThisMonth: number;
  month: string;
}> {
  const me = await requirePortalEmployee();
  const today = todayIST();
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = `${today.slice(0, 7)}-31`;

  const [{ paidLeavesPerMonth }, rows] = await Promise.all([
    readTeamPolicy(),
    db
      .select({ kind: leaves.kind, days: leaves.days })
      .from(leaves)
      .where(
        and(
          eq(leaves.employeeId, me.employeeId),
          eq(leaves.status, 'approved'),
          isNull(leaves.deletedAt),
          sql`${leaves.fromDate} >= ${monthStart}`,
          sql`${leaves.fromDate} <= ${monthEnd}`,
        ),
      ),
  ]);

  const usedThisMonth = rows
    .filter((r) => PAID_LEAVE_KINDS.has(r.kind))
    .reduce((s, r) => s + Number.parseFloat(r.days), 0);

  return { perMonth: paidLeavesPerMonth, usedThisMonth, month: today.slice(0, 7) };
}

/* -------------------------------------------------------------------------- */
/* Manager queue                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Every employee below `managerEmployeeId` in the reporting tree, transitively.
 *
 * Cycle-guarded: `reports_to_employee_id` is a plain self-FK with no constraint
 * preventing a → b → a, and the Settings org tree already had to defend against
 * exactly that. Without the `NOT id = ANY(path)` check a cycle would make this
 * recurse until Postgres gave up.
 */
export async function listReportSubtreeIds(managerEmployeeId: string): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE subtree AS (
      SELECT e.id, ARRAY[e.id] AS path
      FROM employees e
      WHERE e.reports_to_employee_id = ${managerEmployeeId}
        AND e.deleted_at IS NULL

      UNION ALL

      SELECT e.id, s.path || e.id
      FROM employees e
      JOIN subtree s ON e.reports_to_employee_id = s.id
      WHERE e.deleted_at IS NULL
        AND NOT (e.id = ANY(s.path))
    )
    SELECT DISTINCT id FROM subtree
  `);

  // db.execute() resolves to the row array itself with this driver; the
  // Array.isArray guard matches how the ledger reports read theirs.
  const rows = Array.isArray(result) ? result : [];
  return rows.map((r) => r.id).filter((id) => id !== managerEmployeeId);
}

export type TeamLeaveRequest = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  kind: string;
  fromDate: string;
  toDate: string;
  days: string;
  notes: string | null;
  appliedAt: string;
  /** Whether this kind counts against the monthly paid allowance. */
  countsAgainstAllowance: boolean;
};

/**
 * Pending leave for everyone below this manager. Nothing like this existed —
 * `getLeaveQueue` is absent from the codebase and the only approval surface was
 * buried in one employee's OS window.
 */
export async function getTeamLeaveQueue(): Promise<TeamLeaveRequest[]> {
  const me = await requirePortalManager();
  const reportIds = await listReportSubtreeIds(me.employeeId);
  if (reportIds.length === 0) return [];

  const rows = await db
    .select({
      id: leaves.id,
      employeeId: leaves.employeeId,
      employeeName: employees.fullName,
      employeeCode: employees.employeeCode,
      kind: leaves.kind,
      fromDate: leaves.fromDate,
      toDate: leaves.toDate,
      days: leaves.days,
      notes: leaves.notes,
      appliedAt: leaves.appliedAt,
    })
    .from(leaves)
    .innerJoin(employees, eq(employees.id, leaves.employeeId))
    .where(
      and(
        inArray(leaves.employeeId, reportIds),
        eq(leaves.status, 'applied'),
        isNull(leaves.deletedAt),
      ),
    )
    .orderBy(desc(leaves.fromDate));

  return rows.map((r) => ({
    ...r,
    appliedAt: r.appliedAt.toISOString(),
    countsAgainstAllowance: PAID_LEAVE_KINDS.has(r.kind),
  }));
}

/** True when `employeeId` is somewhere below the signed-in manager. */
export async function managerCanDecideFor(employeeId: string): Promise<boolean> {
  const me = await requirePortalManager();
  const reportIds = await listReportSubtreeIds(me.employeeId);
  return reportIds.includes(employeeId);
}
