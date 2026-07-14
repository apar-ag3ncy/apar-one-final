'use server';

import { and, asc, eq, gte, isNull, lte, or } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { attendanceRecords, companyHolidays, employees, salaryStructures } from '@/lib/db/schema';
import { isUndefinedTableError } from '@/lib/db/pg-errors';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

/**
 * Prorate each employee's monthly gross by attendance for a month, so the
 * salary-run wizard can pre-fill earnings that an operator then confirms or
 * overrides (capture-not-compute).
 *
 * Per-day rule: the day rate is monthlyGross ÷ calendar days in the month.
 * Every day is PAID — present, work-from-home, leave, company holiday,
 * weekly off, unmarked — except days explicitly marked `absent`, which are
 * the only loss-of-pay days. Payable days = days in month − absent days.
 * Prorated gross = monthlyGross × payableDays / daysInMonth (floored to the
 * paise).
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
  /** Calendar days in the month — the per-day rate divisor. */
  daysInMonth: number;
  /** Loss-of-pay days = days marked 'absent'. */
  lopDays: number;
  payableDays: number;
  proratedGrossPaise: bigint;
};

export type SalaryAttendancePreview = {
  month: string;
  fromDate: string;
  toDate: string;
  /** Calendar days in the month — the per-day rate divisor for everyone. */
  daysInMonth: number;
  holidayCount: number;
  lines: readonly SalaryAttendanceLine[];
};

function monthBounds(month: string): {
  year: number;
  monthIdx: number;
  from: string;
  to: string;
  lastDay: number;
} {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { year: y, monthIdx: m - 1, from: `${month}-01`, to: `${month}-${pad(lastDay)}`, lastDay };
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

/**
 * The monthly amount to prorate for a salary structure: the sum of its pay
 * components (basic + HRA + special + other allowances) when they're filled in,
 * otherwise the CTC. Many structures are captured as a lump CTC with zero
 * components — treating that as ₹0 gross would prorate to ₹0 and (via the
 * caller's "no data → show full CTC" fallback) end up paying the *undeducted*
 * amount, which is exactly the bug this avoids.
 */
function monthlyBaseForStructure(s: {
  basicPaise: bigint;
  hraPaise: bigint;
  specialAllowancePaise: bigint;
  otherAllowances: unknown;
  ctcMonthlyPaise: bigint;
}): bigint {
  const componentGross =
    s.basicPaise + s.hraPaise + s.specialAllowancePaise + sumAllowances(s.otherAllowances);
  return componentGross > 0n ? componentGross : s.ctcMonthlyPaise;
}

export type EmployeeSalaryAttendancePreview = {
  employeeId: string;
  month: string;
  monthlyGrossPaise: bigint;
  /** Calendar days in the month — the per-day rate divisor. */
  daysInMonth: number;
  /** Days explicitly marked absent — the only days that cut pay. */
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
  void holidayRows; // paid regardless — see the per-day rule below
  void monthIdx;
  void year;
  // Per-day rule: salary ÷ days in the month. Every day counts as PAID —
  // present, work-from-home, leave, company holiday, weekly off — except a
  // day explicitly marked ABSENT. Only absences cut pay.
  const daysInMonth = lastDay;

  // 2) Salary structure overlapping the month for this employee — pick the
  //    latest-starting one (active as of month end), same rule as the run.
  const structures = await db
    .select({
      effectiveFrom: salaryStructures.effectiveFrom,
      basicPaise: salaryStructures.basicPaise,
      hraPaise: salaryStructures.hraPaise,
      specialAllowancePaise: salaryStructures.specialAllowancePaise,
      otherAllowances: salaryStructures.otherAllowances,
      ctcMonthlyPaise: salaryStructures.ctcMonthlyPaise,
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
  const monthlyGrossPaise = picked ? monthlyBaseForStructure(picked) : 0n;

  // 3) Absent (LOP) days — every day marked 'absent' cuts one day's pay.
  //    All other days (present, WFH, leave, holiday, weekly off, unmarked)
  //    are paid.
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
  const lopDays = new Set(absentRows.map((r) => r.date)).size;

  const payableDays = Math.max(0, daysInMonth - lopDays);
  const proratedGrossPaise =
    daysInMonth > 0 ? (monthlyGrossPaise * BigInt(payableDays)) / BigInt(daysInMonth) : 0n;

  return {
    employeeId,
    month,
    monthlyGrossPaise,
    daysInMonth,
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
  void monthIdx;
  void year;
  // Per-day rule: salary ÷ days in the month; only 'absent' days cut pay
  // (present, WFH, leave, holiday, weekly off are all paid).
  const daysInMonth = lastDay;

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
      ctcMonthlyPaise: salaryStructures.ctcMonthlyPaise,
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
    grossByEmployee.set(s.employeeId, monthlyBaseForStructure(s));
  }

  // 4) Absent (LOP) days per employee — every 'absent' cuts one day's pay;
  //    everything else (present, WFH, leave, holiday, weekly off) is paid.
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
    lopByEmployee.set(r.employeeId, (lopByEmployee.get(r.employeeId) ?? 0) + 1);
  }

  const lines: SalaryAttendanceLine[] = emps.map((e) => {
    const monthlyGrossPaise = grossByEmployee.get(e.id) ?? 0n;
    const hasStructure = grossByEmployee.has(e.id);
    const lopDays = lopByEmployee.get(e.id) ?? 0;
    const payableDays = Math.max(0, daysInMonth - lopDays);
    const proratedGrossPaise =
      daysInMonth > 0 ? (monthlyGrossPaise * BigInt(payableDays)) / BigInt(daysInMonth) : 0n;
    return {
      employeeId: e.id,
      fullName: e.fullName,
      monthlyGrossPaise,
      hasStructure,
      daysInMonth,
      lopDays,
      payableDays,
      proratedGrossPaise,
    };
  });

  return {
    month,
    fromDate: from,
    toDate: to,
    daysInMonth,
    holidayCount: holidaySet.size,
    lines,
  };
}
