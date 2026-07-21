import 'server-only';

import { aliasedTable, and, desc, eq, gte, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { bonusesAndPerks, employees, salaryPayments, salaryStructures } from '@/lib/db/schema';
import { fyStartForDate } from '@/lib/billing/fy';
import { todayIST } from '@/lib/ist-date';

import { requirePortalEmployee } from './session';

/**
 * The signed-in employee's OWN record: details, compensation and money ledger.
 *
 * Every query here is scoped to `requirePortalEmployee().employeeId`. These are
 * NEW self-scoped reads rather than calls into `entities/payroll.ts` because:
 *
 *   - `listEmployeeSalaryStructures` / `listEmployeeSalaryPayments` require the
 *     `view_salary` capability, which is UNSCOPED — holding it exposes every
 *     employee's pay. Granting it to the employee role to make this page work
 *     would leak the entire payroll, so it stays ungranted.
 *   - `listEmployeeBonuses`, `listEmployeeReimbursements` and
 *     `getEmployeeStatement` take a caller-supplied `employeeId` with no
 *     ownership check at all.
 *
 * No function here accepts an employee id. There is deliberately no parameter
 * an caller could swap to read someone else's pay.
 */

export type MyDetails = {
  employeeCode: string;
  fullName: string;
  displayName: string | null;
  workEmail: string | null;
  phone: string | null;
  designation: string | null;
  department: string | null;
  employmentType: string;
  status: string;
  joinedOn: string;
  dateOfBirth: string | null;
  confirmedOn: string | null;
  probationEndsOn: string | null;
  /** Own payroll grade — a salary band, so shown to the owner only. */
  payrollGrade: string | null;
  portalRole: string;
  reportsToName: string | null;
};

export type MyPayLine = {
  id: string;
  /** 'salary' | 'bonus' */
  kind: 'salary' | 'bonus';
  date: string;
  amountPaise: bigint;
  label: string;
  method: string | null;
};

export type MyCompensation = {
  current: {
    effectiveFrom: string;
    ctcMonthlyPaise: bigint;
    basicPaise: bigint;
    hraPaise: bigint;
    specialAllowancePaise: bigint;
  } | null;
  lastPayment: { paidOn: string; amountPaise: bigint; method: string } | null;
  /** Total actually paid so far in the current financial year. */
  paidThisFyPaise: bigint;
  fyStart: string;
};

export async function getMyDetails(): Promise<MyDetails> {
  const me = await requirePortalEmployee();
  const manager = aliasedTable(employees, 'manager');

  const [row] = await db
    .select({
      employeeCode: employees.employeeCode,
      fullName: employees.fullName,
      displayName: employees.displayName,
      workEmail: employees.workEmail,
      phone: employees.phone,
      designation: employees.designation,
      department: employees.department,
      employmentType: employees.employmentType,
      status: employees.status,
      joinedOn: employees.joinedOn,
      dateOfBirth: employees.dateOfBirth,
      confirmedOn: employees.confirmedOn,
      probationEndsOn: employees.probationEndsOn,
      payrollGrade: employees.payrollGrade,
      portalRole: employees.portalRole,
      reportsToName: manager.fullName,
    })
    .from(employees)
    .leftJoin(manager, eq(manager.id, employees.reportsToEmployeeId))
    .where(eq(employees.id, me.employeeId))
    .limit(1);

  // requirePortalEmployee already proved the row exists and is live.
  return row!;
}

export async function getMyCompensation(): Promise<MyCompensation> {
  const me = await requirePortalEmployee();
  const today = todayIST();
  const fyStart = fyStartForDate(today);

  const [structures, lastPay, fyTotal] = await Promise.all([
    // Current structure = the one in force today (effective_to NULL or >= today).
    db
      .select({
        effectiveFrom: salaryStructures.effectiveFrom,
        ctcMonthlyPaise: salaryStructures.ctcMonthlyPaise,
        basicPaise: salaryStructures.basicPaise,
        hraPaise: salaryStructures.hraPaise,
        specialAllowancePaise: salaryStructures.specialAllowancePaise,
      })
      .from(salaryStructures)
      .where(
        and(
          eq(salaryStructures.employeeId, me.employeeId),
          isNull(salaryStructures.deletedAt),
          sql`${salaryStructures.effectiveFrom} <= ${today}`,
          sql`(${salaryStructures.effectiveTo} IS NULL OR ${salaryStructures.effectiveTo} >= ${today})`,
        ),
      )
      .orderBy(desc(salaryStructures.effectiveFrom))
      .limit(1),

    db
      .select({
        paidOn: salaryPayments.paidOn,
        amountPaise: salaryPayments.amountPaise,
        method: salaryPayments.paymentMethod,
      })
      .from(salaryPayments)
      .where(and(eq(salaryPayments.employeeId, me.employeeId), isNull(salaryPayments.deletedAt)))
      .orderBy(desc(salaryPayments.paidOn))
      .limit(1),

    db
      .select({ total: sql<string>`coalesce(sum(${salaryPayments.amountPaise}), 0)::text` })
      .from(salaryPayments)
      .where(
        and(
          eq(salaryPayments.employeeId, me.employeeId),
          isNull(salaryPayments.deletedAt),
          gte(salaryPayments.paidOn, fyStart),
        ),
      ),
  ]);

  return {
    current: structures[0] ?? null,
    lastPayment: lastPay[0] ?? null,
    paidThisFyPaise: BigInt(fyTotal[0]?.total ?? '0'),
    fyStart,
  };
}

/**
 * "My ledger" — money that reached this employee, newest first.
 *
 * Deliberately NOT `getEmployeeStatement`: that is the double-entry
 * `incurredByEmployee` subledger (an accounting artifact about expenses the
 * employee incurred), not the "what have I been paid" list an employee
 * actually wants.
 */
export async function getMyLedger(limit = 24): Promise<MyPayLine[]> {
  const me = await requirePortalEmployee();

  const [pays, bonuses] = await Promise.all([
    db
      .select({
        id: salaryPayments.id,
        date: salaryPayments.paidOn,
        amountPaise: salaryPayments.amountPaise,
        method: salaryPayments.paymentMethod,
        notes: salaryPayments.notes,
      })
      .from(salaryPayments)
      .where(and(eq(salaryPayments.employeeId, me.employeeId), isNull(salaryPayments.deletedAt)))
      .orderBy(desc(salaryPayments.paidOn))
      .limit(limit),

    db
      .select({
        id: bonusesAndPerks.id,
        date: bonusesAndPerks.bonusDate,
        amountPaise: bonusesAndPerks.amountPaise,
        description: bonusesAndPerks.description,
        kind: bonusesAndPerks.kind,
      })
      .from(bonusesAndPerks)
      .where(and(eq(bonusesAndPerks.employeeId, me.employeeId), isNull(bonusesAndPerks.deletedAt)))
      .orderBy(desc(bonusesAndPerks.bonusDate))
      .limit(limit),
  ]);

  const lines: MyPayLine[] = [
    ...pays.map((p) => ({
      id: p.id,
      kind: 'salary' as const,
      date: p.date,
      amountPaise: p.amountPaise,
      label: p.notes?.trim() || 'Salary',
      method: p.method,
    })),
    ...bonuses.map((b) => ({
      id: b.id,
      kind: 'bonus' as const,
      date: b.date,
      // bonuses_and_perks.amount_paise is nullable (non-cash perks are captured
      // with a description and no amount).
      amountPaise: b.amountPaise ?? 0n,
      label: b.description || b.kind,
      method: null,
    })),
  ];

  lines.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return lines.slice(0, limit);
}
