'use server';

// Read actions for the employee workspace (the restricted OS employees get
// instead of the admin desktop). Every action is SELF-SCOPED: it resolves the
// signed-in employee from the session via currentEmployee() and only ever
// returns that employee's own data or explicitly-safe, non-financial fields.
// Nothing here exposes compensation, KYC, ledgers, or any accounting surface.

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { employees, projectTasks, projects } from '@/lib/db/schema';
import { currentEmployee } from './employee-auth';
import type {
  EmployeeProjectTaskRow,
  ProjectTaskPriority,
  ProjectTaskSource,
  ProjectTaskStatus,
} from './entities/project-tasks';

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

/**
 * The signed-in employee's own project tasks. Self-scoped — never another
 * employee's. Returns [] when there is no employee session.
 *
 * Deliberately SELF-CONTAINED: it queries directly with `me.id` from the
 * session and does NOT call the admin `listEmployeeProjectTasks`, because that
 * routes through `getActorContext()` — which now denies employee sessions
 * (see actor.ts). The employee data layer must never acquire an admin actor.
 * Shape mirrors EmployeeProjectTaskRow.
 */
export async function listMyTasks(): Promise<readonly EmployeeProjectTaskRow[]> {
  const me = await currentEmployee();
  if (!me) return [];

  const statusOrder = sql<number>`case ${projectTasks.status}
    when 'todo' then 0 when 'in_progress' then 1
    when 'little_delayed' then 2 when 'delayed' then 3
    when 'done' then 4 when 'cancelled' then 5 else 6 end`;

  const rows = await db
    .select({
      taskId: projectTasks.id,
      title: projectTasks.title,
      status: projectTasks.status,
      priority: projectTasks.priority,
      source: projectTasks.source,
      projectId: projectTasks.projectId,
      projectName: projects.name,
      projectCode: projects.code,
      dueOn: projectTasks.dueOn,
      completedAt: projectTasks.completedAt,
    })
    .from(projectTasks)
    .innerJoin(projects, eq(projects.id, projectTasks.projectId))
    .where(
      and(
        // Multi-assignee (0061): membership lives in project_task_assignees.
        sql`exists (
          select 1 from project_task_assignees a
          where a.task_id = ${projectTasks.id} and a.employee_id = ${me.id}
        )`,
        isNull(projectTasks.deletedAt),
      ),
    )
    .orderBy(asc(statusOrder), desc(projectTasks.updatedAt));

  return rows.map(
    (r): EmployeeProjectTaskRow => ({
      taskId: r.taskId,
      title: r.title,
      status: r.status as ProjectTaskStatus,
      priority: (r.priority as ProjectTaskPriority | null) ?? null,
      source: (r.source as ProjectTaskSource | null) ?? null,
      projectId: r.projectId,
      projectName: r.projectName,
      projectCode: r.projectCode,
      dueOn: r.dueOn,
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    }),
  );
}

export type EmployeeActionResult = { ok: true } | { ok: false; error: string };

const EMPLOYEE_SETTABLE_STATUSES: ReadonlySet<ProjectTaskStatus> = new Set([
  'todo',
  'in_progress',
  'little_delayed',
  'delayed',
  'done',
  'cancelled',
]);

/**
 * Move ONE of the signed-in employee's own tasks to a new status. Self-scoped:
 * the update only fires for a task actually assigned to this employee (checked
 * against project_task_assignees), so an employee can never touch a colleague's
 * task. Follows the admin rule: completed_at is set on entry to 'done' and
 * cleared on exit. Self-contained — never calls getActorContext (employees are
 * denied an admin actor).
 */
export async function updateMyTaskStatus(
  taskId: string,
  status: string,
): Promise<EmployeeActionResult> {
  const me = await currentEmployee();
  if (!me) return { ok: false, error: 'Your session has expired. Sign in again.' };

  if (!EMPLOYEE_SETTABLE_STATUSES.has(status as ProjectTaskStatus)) {
    return { ok: false, error: 'Invalid status.' };
  }
  const nextStatus = status as ProjectTaskStatus;

  try {
    const [row] = await db
      .select({ status: projectTasks.status })
      .from(projectTasks)
      .where(
        and(
          eq(projectTasks.id, taskId),
          isNull(projectTasks.deletedAt),
          sql`exists (
            select 1 from project_task_assignees a
            where a.task_id = ${projectTasks.id} and a.employee_id = ${me.id}
          )`,
        ),
      )
      .limit(1);

    if (!row) return { ok: false, error: 'Task not found or not assigned to you.' };

    // completed_at follows the 'done' status: set on entry, clear on exit.
    let completedAtPatch: { completedAt: Date | null } | Record<string, never> = {};
    if (nextStatus !== row.status) {
      if (nextStatus === 'done') completedAtPatch = { completedAt: new Date() };
      else if (row.status === 'done') completedAtPatch = { completedAt: null };
    }

    await db
      .update(projectTasks)
      .set({ status: nextStatus, ...completedAtPatch })
      .where(eq(projectTasks.id, taskId));

    return { ok: true };
  } catch (e) {
    console.error('[updateMyTaskStatus] failed', e);
    return { ok: false, error: 'Couldn’t update the task. Please try again.' };
  }
}
