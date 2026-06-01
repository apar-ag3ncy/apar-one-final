'use server';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { attendanceRecords, leaves } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { getActorContext } from '@/lib/server/actor';

const AttendanceStatusEnum = z.enum([
  'present',
  'work_from_home',
  'absent',
  'half_day',
  'on_leave',
  'weekly_off',
  'holiday',
]);

export type AttendanceStatus = z.infer<typeof AttendanceStatusEnum>;

export type AttendanceRow = {
  id: string;
  date: string;
  status: AttendanceStatus;
  leaveId: string | null;
  notes: string | null;
};

function rowToAttendance(r: typeof attendanceRecords.$inferSelect): AttendanceRow {
  return {
    id: r.id,
    date: r.date,
    status: r.status,
    leaveId: r.leaveId,
    notes: r.notes,
  };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

const MarkAttendanceSchema = z.object({
  employeeId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  status: AttendanceStatusEnum,
  leaveId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type MarkAttendanceInput = z.infer<typeof MarkAttendanceSchema>;

/**
 * Upsert attendance for (employee, date). One row per day. Idempotent.
 */
export async function markAttendance(input: MarkAttendanceInput): Promise<AttendanceRow> {
  const ctx = await getActorContext();
  const parsed = MarkAttendanceSchema.parse(input);

  const existing = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.employeeId, parsed.employeeId),
        eq(attendanceRecords.date, parsed.date),
        isNull(attendanceRecords.deletedAt),
      ),
    )
    .limit(1);

  if (existing[0]) {
    const [row] = await db
      .update(attendanceRecords)
      .set({
        status: parsed.status,
        leaveId: parsed.leaveId ?? null,
        notes: parsed.notes ?? null,
        updatedBy: ctx.userId,
      })
      .where(eq(attendanceRecords.id, existing[0].id))
      .returning();
    if (!row) throw new AppError('internal', 'attendance update returned no row');
    return rowToAttendance(row);
  }

  const [row] = await db
    .insert(attendanceRecords)
    .values({
      employeeId: parsed.employeeId,
      date: parsed.date,
      status: parsed.status,
      leaveId: parsed.leaveId ?? null,
      notes: parsed.notes ?? null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning();
  if (!row) throw new AppError('internal', 'attendance insert returned no row');
  return rowToAttendance(row);
}

/**
 * Clear an attendance entry (soft-delete). Used when the marker realises
 * they marked the wrong day.
 */
export async function clearAttendance(args: { employeeId: string; date: string }): Promise<void> {
  const ctx = await getActorContext();
  await db
    .update(attendanceRecords)
    .set({ deletedAt: new Date(), updatedBy: ctx.userId })
    .where(
      and(
        eq(attendanceRecords.employeeId, args.employeeId),
        eq(attendanceRecords.date, args.date),
        isNull(attendanceRecords.deletedAt),
      ),
    );
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listAttendance(args: {
  employeeId: string;
  fromDate: string;
  toDate: string;
}): Promise<readonly AttendanceRow[]> {
  await getActorContext();
  const rows = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.employeeId, args.employeeId),
        sql`${attendanceRecords.date} BETWEEN ${args.fromDate} AND ${args.toDate}`,
        isNull(attendanceRecords.deletedAt),
      ),
    )
    .orderBy(sql`${attendanceRecords.date} DESC`);
  return rows.map(rowToAttendance);
}

/**
 * Matrix view for the OS Attendance app. Returns every active employee
 * plus every stored attendance override in the date range. The UI fills
 * in the default ('present' Mon–Sat, 'weekly_off' on Sundays) for any
 * (employee, date) without a record — so the DB only stores exceptions
 * to that default.
 */
export type EmployeeAttendanceMatrixRow = {
  employeeId: string;
  fullName: string;
  designation: string | null;
  department: string | null;
  /** YYYY-MM-DD → status. Only stored overrides. */
  overrides: Record<string, AttendanceStatus>;
};

export async function listAttendanceMatrix(args: {
  fromDate: string;
  toDate: string;
}): Promise<readonly EmployeeAttendanceMatrixRow[]> {
  await getActorContext();
  const { employees } = await import('@/lib/db/schema');

  const empRows = await db
    .select({
      id: employees.id,
      fullName: employees.fullName,
      designation: employees.designation,
      department: employees.department,
    })
    .from(employees)
    .where(and(eq(employees.isArchived, false), isNull(employees.deletedAt)))
    .orderBy(employees.fullName);

  const recRows = await db
    .select({
      employeeId: attendanceRecords.employeeId,
      date: attendanceRecords.date,
      status: attendanceRecords.status,
    })
    .from(attendanceRecords)
    .where(
      and(
        sql`${attendanceRecords.date} BETWEEN ${args.fromDate} AND ${args.toDate}`,
        isNull(attendanceRecords.deletedAt),
      ),
    );

  const byEmployee = new Map<string, Record<string, AttendanceStatus>>();
  for (const r of recRows) {
    const prev = byEmployee.get(r.employeeId) ?? {};
    prev[r.date] = r.status;
    byEmployee.set(r.employeeId, prev);
  }

  return empRows.map((e) => ({
    employeeId: e.id,
    fullName: e.fullName,
    designation: e.designation,
    department: e.department,
    overrides: byEmployee.get(e.id) ?? {},
  }));
}

/**
 * Bulk write — stamp one status across many (employee, date) pairs in a
 * single transaction. The Attendance app uses this for actions like
 * "Mark whole team WFH today."
 */
export async function markAttendanceBulk(input: {
  pairs: ReadonlyArray<{ employeeId: string; date: string }>;
  status: AttendanceStatus;
}): Promise<{ written: number }> {
  const ctx = await getActorContext();
  const status = AttendanceStatusEnum.parse(input.status);
  if (input.pairs.length === 0) return { written: 0 };

  let written = 0;
  await db.transaction(async (tx) => {
    for (const { employeeId, date } of input.pairs) {
      const existing = await tx
        .select({ id: attendanceRecords.id })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.employeeId, employeeId),
            eq(attendanceRecords.date, date),
            isNull(attendanceRecords.deletedAt),
          ),
        )
        .limit(1);
      if (existing[0]) {
        await tx
          .update(attendanceRecords)
          .set({ status, updatedBy: ctx.userId })
          .where(eq(attendanceRecords.id, existing[0].id));
      } else {
        await tx.insert(attendanceRecords).values({
          employeeId,
          date,
          status,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
      }
      written++;
    }
  });
  return { written };
}

// defaultStatusForDate moved to `@/lib/attendance-defaults` — modules
// marked 'use server' can only export async functions, and the UI needs
// a synchronous helper for grid rendering.

/* -------------------------------------------------------------------------- */
/* Leave balance                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Annual leave entitlement by kind. Hardcoded for v1 — make this
 * configurable via `settings` once HR confirms the exact policy.
 *   - earned: 21 days (PL)
 *   - casual: 12 days (CL)
 *   - sick:   12 days (SL)
 *   - comp_off: accrued, no fixed cap; surfaced as days-taken only
 *   - unpaid:  no cap
 *   - maternity / paternity: statutory, kept here as informational caps
 */
const LEAVE_ENTITLEMENT: Record<string, number | null> = {
  earned: 21,
  casual: 12,
  sick: 12,
  comp_off: null,
  unpaid: null,
  maternity: 180,
  paternity: 15,
};

export type LeaveBalanceRow = {
  kind: 'earned' | 'casual' | 'sick' | 'unpaid' | 'comp_off' | 'maternity' | 'paternity';
  /** Whole + half days approved during this FY. */
  daysTaken: number;
  /** Annual entitlement; null = uncapped. */
  entitled: number | null;
  /** entitled - daysTaken (floored at 0); null if uncapped. */
  remaining: number | null;
};

/**
 * Returns leave balance per kind for an employee in the given Indian FY
 * (April fy-1 → March fy). `daysTaken` counts only APPROVED leaves.
 */
export async function getLeaveBalance(args: {
  employeeId: string;
  /** Indian FY where FY 2026 = Apr 2025 → Mar 2026. Defaults to current FY. */
  fiscalYear?: number;
}): Promise<readonly LeaveBalanceRow[]> {
  await getActorContext();
  const now = new Date();
  const month = now.getMonth() + 1;
  const defaultFy = month >= 4 ? now.getFullYear() + 1 : now.getFullYear();
  const fy = args.fiscalYear ?? defaultFy;
  const fyStart = `${fy - 1}-04-01`;
  const fyEnd = `${fy}-03-31`;

  const rows = await db
    .select({
      kind: leaves.kind,
      daysTakenText: sql<string>`coalesce(sum(${leaves.days}::numeric), 0)::text`,
    })
    .from(leaves)
    .where(
      and(
        eq(leaves.employeeId, args.employeeId),
        eq(leaves.status, 'approved'),
        sql`${leaves.fromDate} >= ${fyStart}`,
        sql`${leaves.fromDate} <= ${fyEnd}`,
        isNull(leaves.deletedAt),
      ),
    )
    .groupBy(leaves.kind);

  const kinds: LeaveBalanceRow['kind'][] = [
    'earned',
    'casual',
    'sick',
    'unpaid',
    'comp_off',
    'maternity',
    'paternity',
  ];
  return kinds.map((kind) => {
    const found = rows.find((r) => r.kind === kind);
    const daysTaken = found ? Number.parseFloat(found.daysTakenText) : 0;
    const entitled = LEAVE_ENTITLEMENT[kind] ?? null;
    return {
      kind,
      daysTaken,
      entitled,
      remaining: entitled === null ? null : Math.max(0, entitled - daysTaken),
    };
  });
}
