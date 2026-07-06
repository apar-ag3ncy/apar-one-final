'use server';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { attendanceRecords, employees, leaves } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { getActorContext } from '@/lib/server/actor';
import { defaultStatusForDate } from '@/lib/attendance-defaults';

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
 * Effective attendance status for one date, keyed by employee. For every
 * active (non-archived, non-deleted) employee, returns the stored override for
 * `date` if one exists, else the implicit default (`defaultStatusForDate`).
 * Powers the per-day "mark attendance" view where each employee needs a single
 * resolved status to render/edit.
 */
export async function getAttendanceForDate(input: {
  date: string;
}): Promise<Record<string, AttendanceStatus>> {
  await getActorContext();
  const date = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .parse(input.date);

  const empRows = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.isArchived, false), isNull(employees.deletedAt)));

  const overrideRows = await db
    .select({ employeeId: attendanceRecords.employeeId, status: attendanceRecords.status })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.date, date),
        isNull(attendanceRecords.deletedAt),
      ),
    );

  const overrideByEmployee = new Map<string, AttendanceStatus>();
  for (const r of overrideRows) overrideByEmployee.set(r.employeeId, r.status);

  const def = defaultStatusForDate(date);
  const result: Record<string, AttendanceStatus> = {};
  for (const e of empRows) {
    result[e.id] = overrideByEmployee.get(e.id) ?? def;
  }
  return result;
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
/* Import / export                                                             */
/* -------------------------------------------------------------------------- */

export type AttendanceEmployeeOption = {
  id: string;
  employeeCode: string;
  fullName: string;
  designation: string | null;
  department: string | null;
};

/**
 * Active employees for the export picker — lets the dialog offer a checkbox
 * list to scope an export to selected people. Ordered by name.
 */
export async function listAttendanceEmployees(): Promise<readonly AttendanceEmployeeOption[]> {
  await getActorContext();
  const rows = await db
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      fullName: employees.fullName,
      designation: employees.designation,
      department: employees.department,
    })
    .from(employees)
    .where(and(eq(employees.isArchived, false), isNull(employees.deletedAt)))
    .orderBy(employees.fullName);
  return rows;
}

export type AttendanceExportRecord = {
  employeeId: string;
  date: string;
  status: AttendanceStatus;
  notes: string | null;
};

const ExportRangeSchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fromDate must be YYYY-MM-DD'),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'toDate must be YYYY-MM-DD'),
  employeeIds: z.array(z.string().uuid()).optional(),
});

/**
 * Pull employees + stored attendance overrides for a date range, optionally
 * restricted to a set of employees. The caller fills the implicit default
 * (present / weekly_off) for any (employee, date) without a record — the same
 * way the matrix grid renders — so the export reflects the effective status
 * while the wire payload stays sparse (only stored exceptions cross over).
 */
export async function getAttendanceForExport(args: {
  fromDate: string;
  toDate: string;
  employeeIds?: readonly string[];
}): Promise<{
  employees: readonly AttendanceEmployeeOption[];
  records: readonly AttendanceExportRecord[];
}> {
  await getActorContext();
  const parsed = ExportRangeSchema.parse(args);
  if (parsed.fromDate > parsed.toDate) {
    throw new AppError('validation', 'The start date must be on or before the end date.');
  }
  const ids = parsed.employeeIds && parsed.employeeIds.length > 0 ? parsed.employeeIds : null;

  const empWhere = [eq(employees.isArchived, false), isNull(employees.deletedAt)];
  if (ids) empWhere.push(inArray(employees.id, ids));
  const empRows = await db
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      fullName: employees.fullName,
      designation: employees.designation,
      department: employees.department,
    })
    .from(employees)
    .where(and(...empWhere))
    .orderBy(employees.fullName);

  const recWhere = [
    sql`${attendanceRecords.date} BETWEEN ${parsed.fromDate} AND ${parsed.toDate}`,
    isNull(attendanceRecords.deletedAt),
  ];
  if (ids) recWhere.push(inArray(attendanceRecords.employeeId, ids));
  const recRows = await db
    .select({
      employeeId: attendanceRecords.employeeId,
      date: attendanceRecords.date,
      status: attendanceRecords.status,
      notes: attendanceRecords.notes,
    })
    .from(attendanceRecords)
    .where(and(...recWhere));

  return { employees: empRows, records: recRows };
}

/**
 * One parsed row from an uploaded sheet. The client resolves nothing — it
 * passes the raw identifier columns (any of code/email/name) plus a
 * normalised date + status, and the server matches the employee and upserts.
 */
export type AttendanceImportRow = {
  code?: string;
  email?: string;
  name?: string;
  date: string;
  status: AttendanceStatus;
  notes?: string | null;
};

export type AttendanceImportResult = {
  /** Rows applied without error (includes rows that matched the default). */
  successCount: number;
  /** Rows whose status matched the default and cleared a prior override. */
  clearedCount: number;
  errors: { index: number; ref: string; message: string }[];
};

const AttendanceImportRowSchema = z.object({
  code: z.string().optional(),
  email: z.string().optional(),
  name: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  status: AttendanceStatusEnum,
  notes: z.string().max(2000).nullable().optional(),
});

/**
 * Bulk import attendance from a parsed sheet. Each row is matched to an
 * employee by Employee Code, then Work Email, then exact Full Name (a
 * duplicate name without a code is rejected). Because the store only keeps
 * exceptions to the implicit default, a row whose status equals the default
 * for that date stores nothing — and clears any prior override so the cell
 * reverts to default. Only the listed (employee, date) pairs are touched;
 * everything else is left alone. Rows are applied independently so one bad
 * row never blocks the rest.
 */
export async function importAttendance(
  rows: readonly AttendanceImportRow[],
): Promise<AttendanceImportResult> {
  const ctx = await getActorContext();

  const allEmps = await db
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      workEmail: employees.workEmail,
      fullName: employees.fullName,
    })
    .from(employees)
    .where(isNull(employees.deletedAt));

  const byCode = new Map<string, string>();
  const byEmail = new Map<string, string>();
  // null marks an ambiguous name (more than one active match).
  const byName = new Map<string, string | null>();
  for (const e of allEmps) {
    if (e.employeeCode) byCode.set(e.employeeCode.trim().toLowerCase(), e.id);
    if (e.workEmail) byEmail.set(e.workEmail.trim().toLowerCase(), e.id);
    const nameKey = e.fullName.trim().toLowerCase();
    byName.set(nameKey, byName.has(nameKey) ? null : e.id);
  }

  let successCount = 0;
  let clearedCount = 0;
  const errors: AttendanceImportResult['errors'] = [];

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]!;
    const ref = raw.code || raw.email || raw.name || `Row ${i + 2}`;
    try {
      const row = AttendanceImportRowSchema.parse(raw);

      let empId: string | undefined;
      const code = row.code?.trim().toLowerCase();
      const email = row.email?.trim().toLowerCase();
      const name = row.name?.trim().toLowerCase();
      if (code && byCode.has(code)) {
        empId = byCode.get(code);
      } else if (email && byEmail.has(email)) {
        empId = byEmail.get(email);
      } else if (name) {
        const hit = byName.get(name);
        if (hit === null) {
          throw new AppError(
            'validation',
            `More than one employee is named "${row.name}". Use Employee Code.`,
          );
        }
        empId = hit ?? undefined;
      }
      if (!empId) {
        throw new AppError(
          'validation',
          'No matching employee — check the Employee Code, Email or Name.',
        );
      }

      const def = defaultStatusForDate(row.date);
      const notes = row.notes?.trim() ? row.notes.trim() : null;

      const existing = await db
        .select({ id: attendanceRecords.id })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.employeeId, empId),
            eq(attendanceRecords.date, row.date),
            isNull(attendanceRecords.deletedAt),
          ),
        )
        .limit(1);

      if (row.status === def && !notes) {
        // Effective status equals the implicit default — store nothing, and
        // clear any prior override so the cell reverts to its default.
        if (existing[0]) {
          await db
            .update(attendanceRecords)
            .set({ deletedAt: new Date(), updatedBy: ctx.userId })
            .where(eq(attendanceRecords.id, existing[0].id));
          clearedCount++;
        }
        successCount++;
        continue;
      }

      if (existing[0]) {
        await db
          .update(attendanceRecords)
          .set({ status: row.status, notes, updatedBy: ctx.userId })
          .where(eq(attendanceRecords.id, existing[0].id));
      } else {
        await db.insert(attendanceRecords).values({
          employeeId: empId,
          date: row.date,
          status: row.status,
          notes,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
      }
      successCount++;
    } catch (e) {
      errors.push({
        index: i,
        ref,
        message: e instanceof Error ? e.message : 'Could not import row.',
      });
    }
  }

  return { successCount, clearedCount, errors };
}

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
