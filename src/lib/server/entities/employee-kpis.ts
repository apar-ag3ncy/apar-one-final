'use server';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import {
  attendanceRecords,
  employees,
  projectMembers,
  projects,
  projectTaskAssignees,
  projectTasks,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { getActorContext } from '@/lib/server/actor';
import { defaultStatusForDate } from '@/lib/attendance-defaults';
import { todayIST } from '@/lib/ist-date';

/**
 * Display-only KPI aggregates for the OS employee window's "KPIs" tab.
 * Everything is derived from existing tables — attendance_records (plus the
 * implicit present/weekly-off default), project_tasks + project_task_assignees
 * (deliverables), project_members (memberships), and employees.joined_on
 * (tenure). No new storage; "today"/"this month" are resolved in Asia/Kolkata.
 */

export type EmployeeKpis = {
  /** Month the attendance block covers, YYYY-MM (IST). */
  month: string;
  attendance: {
    /** present + work_from_home days so far this month. */
    presentDays: number;
    halfDays: number;
    onLeaveDays: number;
    absentDays: number;
    /** Days elapsed this month that are not weekly-off / holiday. */
    workingDaysElapsed: number;
    /** (present + 0.5 × half) / workingDaysElapsed, rounded; null if none. */
    attendancePct: number | null;
  };
  deliverables: {
    assigned: number;
    completed: number;
    /** completed / assigned, rounded; null when nothing is assigned. */
    completionPct: number | null;
  };
  projects: {
    /** Memberships (project_members) on non-archived projects with status 'active'. */
    activeMemberships: number;
  };
  tenure: {
    /** Whole months since joined_on (IST today). */
    months: number;
    joinedOn: string;
  };
};

/** Whole calendar months from `fromIso` to `toIso` (both YYYY-MM-DD), floored at 0. */
function wholeMonthsBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return 0;
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

export async function getEmployeeKpis(input: { employeeId: string }): Promise<EmployeeKpis> {
  await getActorContext();
  const employeeId = z.string().uuid().parse(input.employeeId);

  const empRows = await db
    .select({ joinedOn: employees.joinedOn })
    .from(employees)
    .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)))
    .limit(1);
  const emp = empRows[0];
  if (!emp) throw new AppError('not_found', `Employee ${employeeId} not found`);

  const today = todayIST();
  const monthStart = `${today.slice(0, 7)}-01`;

  const [overrides, taskRows, memberRows] = await Promise.all([
    // Stored attendance overrides this month; the default fills the rest.
    db
      .select({ date: attendanceRecords.date, status: attendanceRecords.status })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.employeeId, employeeId),
          sql`${attendanceRecords.date} BETWEEN ${monthStart} AND ${today}`,
          isNull(attendanceRecords.deletedAt),
        ),
      ),

    // Deliverables assigned to this employee (all time, soft-deletes excluded).
    db
      .select({
        assigned: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${projectTasks.status} = 'done')::int`,
      })
      .from(projectTaskAssignees)
      .innerJoin(projectTasks, eq(projectTasks.id, projectTaskAssignees.taskId))
      .where(and(eq(projectTaskAssignees.employeeId, employeeId), isNull(projectTasks.deletedAt))),

    // Team memberships on currently-active projects.
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(
        and(
          eq(projectMembers.employeeId, employeeId),
          eq(projects.status, 'active'),
          eq(projects.isArchived, false),
          isNull(projects.deletedAt),
        ),
      ),
  ]);

  // Walk every day of the month so far; effective status = override ?? default.
  const overrideByDate = new Map(overrides.map((r) => [r.date, r.status]));
  let presentDays = 0;
  let halfDays = 0;
  let onLeaveDays = 0;
  let absentDays = 0;
  let offDays = 0;
  let totalDays = 0;
  const cursor = new Date(`${monthStart}T00:00:00Z`);
  const end = new Date(`${today}T00:00:00Z`);
  while (cursor <= end) {
    const iso = cursor.toISOString().slice(0, 10);
    const status = overrideByDate.get(iso) ?? defaultStatusForDate(iso);
    totalDays++;
    if (status === 'present' || status === 'work_from_home') presentDays++;
    else if (status === 'half_day') halfDays++;
    else if (status === 'on_leave') onLeaveDays++;
    else if (status === 'absent') absentDays++;
    else offDays++; // weekly_off / holiday
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const workingDaysElapsed = totalDays - offDays;
  const attendancePct =
    workingDaysElapsed > 0
      ? Math.round(((presentDays + 0.5 * halfDays) / workingDaysElapsed) * 100)
      : null;

  const assigned = taskRows[0]?.assigned ?? 0;
  const completed = taskRows[0]?.completed ?? 0;

  return {
    month: today.slice(0, 7),
    attendance: {
      presentDays,
      halfDays,
      onLeaveDays,
      absentDays,
      workingDaysElapsed,
      attendancePct,
    },
    deliverables: {
      assigned,
      completed,
      completionPct: assigned > 0 ? Math.round((completed / assigned) * 100) : null,
    },
    projects: { activeMemberships: memberRows[0]?.n ?? 0 },
    tenure: { months: wholeMonthsBetween(emp.joinedOn, today), joinedOn: emp.joinedOn },
  };
}
