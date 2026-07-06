'use server';

import { and, asc, eq, gte, isNull, lte, or } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  attendanceRecords,
  companyHolidays,
  employees,
  salaryStructures,
} from '@/lib/db/schema';
import { isUndefinedTableError } from '@/lib/db/pg-errors';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

/**
 * Prorate each employee's monthly gross by attendance for a month, so the
 * salary-run wizard can pre-fill earnings that an operator then confirms or
 * overrides (capture-not-compute).
 *
 * Working days = calendar days in the month, minus Sundays, minus company
 * holidays (Settings → Holidays). Loss-of-pay = days marked `absent` only
 * (every leave kind, WFH, half-day, weekly-off and holiday are treated as
 * paid). Payable days = working days − LOP. Prorated gross =
 * monthlyGross × payableDays / workingDays (floored to the paise).
 *
 * Read-only: computes and returns; it never writes a salary run or the ledger.
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export type SalaryAttendanceLine = {
  employeeId: string;
  fullName: string;
  /** Monthly gross from the active salary structure (basic + HRA + special + other allowances). */
  monthlyGrossPaise: bigint;
  /** True when the employee has an active salary structure for the month. */
  hasStructure: boolean;
  workingDays: number;
  /** Loss-of-pay days = days marked 'absent'. */
  lopDays: number;
  payableDays: number;
  proratedGrossPaise: bigint;
};

export type SalaryAttendancePreview = {
  month: string;
  fromDate: string;
  toDate: string;
  /** Company-wide working days for the month (same for every employee). */
  workingDays: number;
  holidayCount: number;
  lines: readonly SalaryAttendanceLine[];
};

function monthBounds(month: string): { year: number; monthIdx: number; from: string; to: string; lastDay: number } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { year: y, monthIdx: m - 1, from: `${month}-01`, to: `${month}-${pad(lastDay)}`, lastDay };
}

/** Working days = every day that isn't a Sunday and isn't a company holiday. */
function computeWorkingDays(month: string, lastDay: number, monthIdx: number, year: number, holidays: ReadonlySet<string>): number {
  const pad = (n: number) => String(n).padStart(2, '0');
  let count = 0;
  for (let d = 1; d <= lastDay; d += 1) {
    const dow = new Date(Date.UTC(year, monthIdx, d)).getUTCDay();
    if (dow === 0) continue; // Sunday = weekly off
    if (holidays.has(`${month}-${pad(d)}`)) continue; // company holiday
    count += 1;
  }
  return count;
}

function sumAllowances(raw: unknown): bigint {
  if (!Array.isArray(raw)) return 0n;
  let total = 0n;
  for (const r of raw) {
    const amt = (r as { amountPaise?: unknown }).amountPaise;
    if (typeof amt === 'string' && amt.trim() !== '') {
      try {
        total += BigInt(amt);
      } catch {
        /* skip malformed */
      }
    } else if (typeof amt === 'bigint') {
      total += amt;
    } else if (typeof amt === 'number' && Number.isFinite(amt)) {
      total += BigInt(Math.trunc(amt));
    }
  }
  return total;
}

export type EmployeeSalaryAttendancePreview = {
  employeeId: string;
  month: string;
  monthlyGrossPaise: bigint;
  workingDays: number;
  lopDays: number;
  payableDays: number;
  proratedGrossPaise: bigint;
  hasStructure: boolean;
};

/**
 * Single-employee variant of {@link previewSalaryFromAttendance}. Reuses the
 * same working-days / structure-pick / LOP proration, scoped to one employee.
 *
 * Gated with `view_salary` (NOT `create_salary_run`): this reads one person's
 * pay without touching a salary run, so it's the salary-detail capability that
 * applies — same protection `view_salary` gives everywhere else pay is exposed.
 */
export async function previewSalaryForEmployee(input: {
  employeeId: string;
  month: string;
}): Promise<EmployeeSalaryAttendancePreview> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'view_salary');

  const { employeeId, month } = input;
  if (!MONTH_RE.test(month)) {
    throw new AppError('validation', 'month must be YYYY-MM.');
  }
  const { year, monthIdx, from, to, lastDay } = monthBounds(month);

  // 1) Holidays in the month. Degrade to no holidays if migration 0051 hasn't
  //    been applied on this DB yet (same self-healing as the company-wide run).
  let holidayRows: { date: string }[] = [];
  try {
    holidayRows = await db
      .select({ date: companyHolidays.holidayDate })
      .from(companyHolidays)
      .where(
        and(
          isNull(companyHolidays.deletedAt),
          gte(companyHolidays.holidayDate, from),
          lte(companyHolidays.holidayDate, to),
        ),
      );
  } catch (e) {
    if (!isUndefinedTableError(e)) throw e;
  }
  const holidaySet = new Set(holidayRows.map((h) => h.date));
  const workingDays = computeWorkingDays(month, lastDay, monthIdx, year, holidaySet);

  // 2) Salary structure overlapping the month for this employee — pick the
  //    latest-starting one (active as of month end), same rule as the run.
  const structures = await db
    .select({
      effectiveFrom: salaryStructures.effectiveFrom,
      basicPaise: salaryStructures.basicPaise,
      hraPaise: salaryStructures.hraPaise,
      specialAllowancePaise: salaryStructures.specialAllowancePaise,
      otherAllowances: salaryStructures.otherAllowances,
    })
    .from(salaryStructures)
    .where(
      and(
        eq(salaryStructures.employeeId, employeeId),
        isNull(salaryStructures.deletedAt),
        lte(salaryStructures.effectiveFrom, to),
        or(isNull(salaryStructures.effectiveTo), gte(salaryStructures.effectiveTo, from)),
      ),
    )
    .orderBy(asc(salaryStructures.effectiveFrom), asc(salaryStructures.createdAt));
  // Last row = latest-starting / latest-created, matching the company-wide pick.
  const picked = structures.at(-1);
  const hasStructure = picked !== undefined;
  const monthlyGrossPaise = picked
    ? picked.basicPaise +
      picked.hraPaise +
      picked.specialAllowancePaise +
      sumAllowances(picked.otherAllowances)
    : 0n;

  // 3) Absent (LOP) days — only an 'absent' on an actual working day docks pay
  //    (Sundays and company holidays aren't working days, so they never count).
  const absentRows = await db
    .select({ date: attendanceRecords.date })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.employeeId, employeeId),
        isNull(attendanceRecords.deletedAt),
        eq(attendanceRecords.status, 'absent'),
        gte(attendanceRecords.date, from),
        lte(attendanceRecords.date, to),
      ),
    );
  let lopDays = 0;
  for (const r of absentRows) {
    const [ry, rm, rd] = r.date.split('-').map(Number);
    const dow = new Date(Date.UTC(ry ?? year, (rm ?? 1) - 1, rd ?? 1)).getUTCDay();
    if (dow === 0 || holidaySet.has(r.date)) continue; // not a working day → not LOP
    lopDays += 1;
  }

  const payableDays = Math.max(0, workingDays - lopDays);
  const proratedGrossPaise =
    workingDays > 0 ? (monthlyGrossPaise * BigInt(payableDays)) / BigInt(workingDays) : 0n;

  return {
    employeeId,
    month,
    monthlyGrossPaise,
    workingDays,
    lopDays,
    payableDays,
    proratedGrossPaise,
    hasStructure,
  };
}

export async function previewSalaryFromAttendance(month: string): Promise<SalaryAttendancePreview> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'create_salary_run');
  // Returns per-employee gross — the same salary detail `view_salary` protects
  // everywhere else it's exposed (payroll.ts). Require it here too so a custom
  // role with create_salary_run but not view_salary can't read everyone's pay.
  requireCapability(ctx, 'view_salary');

  if (!MONTH_RE.test(month)) {
    throw new AppError('validation', 'month must be YYYY-MM.');
  }
  const { year, monthIdx, from, to, lastDay } = monthBounds(month);

  // 1) Holidays in the month. If migration 0051 hasn't been applied on this DB
  //    yet, degrade to no holidays (working days = calendar − Sundays) rather
  //    than failing the whole run — it self-heals once the table exists.
  let holidayRows: { date: string }[] = [];
  try {
    holidayRows = await db
      .select({ date: companyHolidays.holidayDate })
      .from(companyHolidays)
      .where(
        and(
          isNull(companyHolidays.deletedAt),
          gte(companyHolidays.holidayDate, from),
          lte(companyHolidays.holidayDate, to),
        ),
      );
  } catch (e) {
    if (!isUndefinedTableError(e)) throw e;
  }
  const holidaySet = new Set(holidayRows.map((h) => h.date));
  const workingDays = computeWorkingDays(month, lastDay, monthIdx, year, holidaySet);

  // 2) Active employees.
  const emps = await db
    .select({ id: employees.id, fullName: employees.fullName })
    .from(employees)
    .where(and(eq(employees.status, 'active'), isNull(employees.deletedAt)))
    .orderBy(employees.fullName);

  // 3) Salary structures overlapping the month — pick the latest-starting one
  //    per employee (active as of month end).
  const structures = await db
    .select({
      employeeId: salaryStructures.employeeId,
      effectiveFrom: salaryStructures.effectiveFrom,
      basicPaise: salaryStructures.basicPaise,
      hraPaise: salaryStructures.hraPaise,
      specialAllowancePaise: salaryStructures.specialAllowancePaise,
      otherAllowances: salaryStructures.otherAllowances,
    })
    .from(salaryStructures)
    .where(
      and(
        isNull(salaryStructures.deletedAt),
        // Overlaps the month: started on/before month-end AND (open-ended OR
        // ended on/after month-start).
        lte(salaryStructures.effectiveFrom, to),
        or(isNull(salaryStructures.effectiveTo), gte(salaryStructures.effectiveTo, from)),
      ),
    )
    // Deterministic pick when several structures overlap the month (a mid-month
    // revision, or two rows sharing an effectiveFrom): oldest → newest, so the
    // last write per employee below is the latest-starting / latest-created one.
    .orderBy(asc(salaryStructures.effectiveFrom), asc(salaryStructures.createdAt));
  const grossByEmployee = new Map<string, bigint>();
  for (const s of structures) {
    grossByEmployee.set(
      s.employeeId,
      s.basicPaise + s.hraPaise + s.specialAllowancePaise + sumAllowances(s.otherAllowances),
    );
  }

  // 4) Absent (LOP) days per employee in the month. Only an 'absent' marked on
  //    an actual working day docks pay — an absent override on a Sunday or a
  //    company holiday is not a working day, so it must not reduce payable days
  //    (else payableDays = workingDays − lop would subtract a non-working day).
  const absentRows = await db
    .select({ employeeId: attendanceRecords.employeeId, date: attendanceRecords.date })
    .from(attendanceRecords)
    .where(
      and(
        isNull(attendanceRecords.deletedAt),
        eq(attendanceRecords.status, 'absent'),
        gte(attendanceRecords.date, from),
        lte(attendanceRecords.date, to),
      ),
    );
  const lopByEmployee = new Map<string, number>();
  for (const r of absentRows) {
    const [ry, rm, rd] = r.date.split('-').map(Number);
    const dow = new Date(Date.UTC(ry ?? year, (rm ?? 1) - 1, rd ?? 1)).getUTCDay();
    if (dow === 0 || holidaySet.has(r.date)) continue; // not a working day → not LOP
    lopByEmployee.set(r.employeeId, (lopByEmployee.get(r.employeeId) ?? 0) + 1);
  }

  const lines: SalaryAttendanceLine[] = emps.map((e) => {
    const monthlyGrossPaise = grossByEmployee.get(e.id) ?? 0n;
    const hasStructure = grossByEmployee.has(e.id);
    const lopDays = lopByEmployee.get(e.id) ?? 0;
    const payableDays = Math.max(0, workingDays - lopDays);
    // 0 payable days → 0 pay. (workingDays === 0 is unreachable for a real
    // month, but the degenerate case must floor to 0, not the full gross.)
    const proratedGrossPaise =
      workingDays > 0 ? (monthlyGrossPaise * BigInt(payableDays)) / BigInt(workingDays) : 0n;
    return {
      employeeId: e.id,
      fullName: e.fullName,
      monthlyGrossPaise,
      hasStructure,
      workingDays,
      lopDays,
      payableDays,
      proratedGrossPaise,
    };
  });

  return {
    month,
    fromDate: from,
    toDate: to,
    workingDays,
    holidayCount: holidaySet.size,
    lines,
  };
}
