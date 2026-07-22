'use server';

// Read actions for the employee workspace (the restricted OS employees get
// instead of the admin desktop). Every action is SELF-SCOPED: it resolves the
// signed-in employee from the session via currentEmployee() and only ever
// returns that employee's own data or explicitly-safe, non-financial fields.
// Nothing here exposes compensation, KYC, ledgers, or any accounting surface.

import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';
import { currentEmployee } from './employee-auth';
import { listEmployeeProjectTasks, type EmployeeProjectTaskRow } from './entities/project-tasks';

export type TeamMember = {
  id: string;
  employeeCode: string;
  fullName: string;
  displayName: string | null;
  designation: string | null;
  department: string | null;
  isSelf: boolean;
};

/**
 * Safe teammate directory for the employee workspace. Active, non-separated,
 * non-archived employees; only non-sensitive identity fields — never
 * compensation, KYC, contact details, or anything financial. Returns [] when
 * there is no employee session.
 */
export async function listMyTeam(): Promise<TeamMember[]> {
  const me = await currentEmployee();
  if (!me) return [];

  const rows = await db
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      fullName: employees.fullName,
      displayName: employees.displayName,
      designation: employees.designation,
      department: employees.department,
    })
    .from(employees)
    .where(
      and(
        isNull(employees.deletedAt),
        eq(employees.isArchived, false),
        sql`${employees.status} <> 'separated'`,
      ),
    )
    .orderBy(asc(employees.fullName));

  return rows.map((r) => ({ ...r, isSelf: r.id === me.id }));
}

/** The signed-in employee's own project tasks. Self-scoped — never another
 * employee's. Returns [] when there is no employee session. */
export async function listMyTasks(): Promise<readonly EmployeeProjectTaskRow[]> {
  const me = await currentEmployee();
  if (!me) return [];
  return listEmployeeProjectTasks(me.id);
}
