'use server';

// Read actions for the employee workspace (the restricted OS employees get
// instead of the admin desktop). Every action is SELF-SCOPED: it resolves the
// signed-in employee from the session via currentEmployee() and only ever
// returns that employee's own data or explicitly-safe, non-financial fields.
// Nothing here exposes compensation, KYC, ledgers, or any accounting surface.

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { attendanceRecords, employees, leaves, projectTasks, projects } from '@/lib/db/schema';
import { defaultStatusForDate } from '@/lib/attendance-defaults';
import { currentEmployee } from './employee-auth';
import type { AttendanceStatus } from './entities/attendance';
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

/* -------------------------------------------------------------------------- */
/* Attendance (self-view, read-only)                                          */
/* -------------------------------------------------------------------------- */

export type MyAttendanceDay = {
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  /** true when this is the implicit default (no stored override). */
  isDefault: boolean;
  /** true for dates after `today` (not yet counted in the summary). */
  isFuture: boolean;
};

export type MyAttendanceSummary = {
  present: number;
  workFromHome: number;
  halfDay: number;
  onLeave: number;
  absent: number;
  weeklyOff: number;
  holiday: number;
  /** present + wfh + half_day + absent + on_leave (i.e. non-off working days). */
  workingDays: number;
  /** round((present + wfh + 0.5*half_day) / workingDays * 100); null if none. */
  attendancePct: number | null;
};

export type MyAttendance = {
  month: string; // YYYY-MM
  monthLabel: string; // "July 2026"
  days: MyAttendanceDay[];
  summary: MyAttendanceSummary;
};

const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * The signed-in employee's own attendance for `month` (YYYY-MM), with `today`
 * (YYYY-MM-DD) supplied by the client to avoid server-timezone drift. Fills the
 * implicit default (present Mon–Sat, weekly_off Sun) for any day without a
 * stored override — the DB only records exceptions. Summary counts non-future
 * days only. Self-scoped: only this employee's records; returns null with no
 * session.
 */
export async function getMyAttendance(month: string, today: string): Promise<MyAttendance | null> {
  const me = await currentEmployee();
  if (!me) return null;
  if (!MONTH_RE.test(month) || !DATE_RE.test(today)) return null;

  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)); // 1-12
  if (m < 1 || m > 12) return null;

  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstDay = `${month}-01`;
  const lastDay = `${month}-${pad2(daysInMonth)}`;

  const rows = await db
    .select({ date: attendanceRecords.date, status: attendanceRecords.status })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.employeeId, me.id),
        sql`${attendanceRecords.date} between ${firstDay} and ${lastDay}`,
        isNull(attendanceRecords.deletedAt),
      ),
    );

  const overrides = new Map<string, AttendanceStatus>();
  for (const r of rows) overrides.set(String(r.date), r.status as AttendanceStatus);

  const counts: Record<AttendanceStatus, number> = {
    present: 0,
    work_from_home: 0,
    absent: 0,
    half_day: 0,
    on_leave: 0,
    weekly_off: 0,
    holiday: 0,
  };
  const days: MyAttendanceDay[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${month}-${pad2(d)}`;
    const isFuture = date > today;
    const override = overrides.get(date);
    const status = override ?? defaultStatusForDate(date);
    days.push({ date, status, isDefault: override === undefined, isFuture });
    if (!isFuture) counts[status] += 1;
  }

  const workingDays =
    counts.present + counts.work_from_home + counts.half_day + counts.absent + counts.on_leave;
  const attended = counts.present + counts.work_from_home + counts.half_day * 0.5;
  const attendancePct = workingDays > 0 ? Math.round((attended / workingDays) * 100) : null;

  return {
    month,
    monthLabel: `${MONTH_NAMES[m - 1] ?? month} ${y}`,
    days,
    summary: {
      present: counts.present,
      workFromHome: counts.work_from_home,
      halfDay: counts.half_day,
      onLeave: counts.on_leave,
      absent: counts.absent,
      weeklyOff: counts.weekly_off,
      holiday: counts.holiday,
      workingDays,
      attendancePct,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* UI preferences (self-scoped) — theme, dock size, accent, …                 */
/* -------------------------------------------------------------------------- */

/** The signed-in employee's saved OS UI prefs (or null). Self-scoped. */
export async function getMyPreferences(): Promise<Record<string, unknown> | null> {
  const me = await currentEmployee();
  if (!me) return null;
  try {
    const [row] = await db
      .select({ uiPrefs: employees.uiPrefs })
      .from(employees)
      .where(eq(employees.id, me.id))
      .limit(1);
    const p = row?.uiPrefs;
    return p && typeof p === 'object' ? (p as Record<string, unknown>) : null;
  } catch (e) {
    console.error('[getMyPreferences] failed', e);
    return null;
  }
}

/** Shallow-merge `patch` into the signed-in employee's UI prefs. Self-scoped. */
export async function saveMyPreferences(patch: Record<string, unknown>): Promise<void> {
  const me = await currentEmployee();
  if (!me) return;
  try {
    // jsonb `||` is a shallow merge; coalesce covers a first-write NULL.
    await db
      .update(employees)
      .set({
        uiPrefs: sql`coalesce(${employees.uiPrefs}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
      })
      .where(eq(employees.id, me.id));
  } catch (e) {
    console.error('[saveMyPreferences] failed', e);
  }
}

/** Clear the signed-in employee's saved UI prefs (revert to defaults). */
export async function resetMyPreferences(): Promise<void> {
  const me = await currentEmployee();
  if (!me) return;
  try {
    await db.update(employees).set({ uiPrefs: null }).where(eq(employees.id, me.id));
  } catch (e) {
    console.error('[resetMyPreferences] failed', e);
  }
}

/* -------------------------------------------------------------------------- */
/* Leaves — employee apply/list/cancel + manager review/decide (self-scoped)  */
/* -------------------------------------------------------------------------- */

export type LeaveKind =
  | 'earned'
  | 'casual'
  | 'sick'
  | 'unpaid'
  | 'comp_off'
  | 'maternity'
  | 'paternity';
export type LeaveStatus = 'applied' | 'approved' | 'rejected' | 'cancelled';

export type MyLeave = {
  id: string;
  kind: LeaveKind;
  fromDate: string;
  toDate: string;
  days: string;
  status: LeaveStatus;
  reason: string | null;
};
export type TeamLeaveRequest = MyLeave & { employeeId: string; employeeName: string };

const LEAVE_KINDS: ReadonlySet<string> = new Set([
  'earned',
  'casual',
  'sick',
  'unpaid',
  'comp_off',
  'maternity',
  'paternity',
]);

const leaveCols = {
  id: leaves.id,
  kind: leaves.kind,
  fromDate: leaves.fromDate,
  toDate: leaves.toDate,
  days: leaves.days,
  status: leaves.status,
  reason: leaves.notes,
};

/** Apply for leave — from/to dates + kind + reason. Files it as 'applied' for
 * the signed-in employee. Self-scoped. */
export async function applyMyLeave(input: {
  fromDate: string;
  toDate: string;
  kind: string;
  reason: string;
}): Promise<EmployeeActionResult> {
  const me = await currentEmployee();
  if (!me) return { ok: false, error: 'Your session has expired. Sign in again.' };

  const { fromDate, toDate, kind } = input;
  const reason = (input.reason ?? '').trim();
  if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) {
    return { ok: false, error: 'Pick valid from and to dates.' };
  }
  if (toDate < fromDate) {
    return { ok: false, error: 'The “to” date can’t be before the “from” date.' };
  }
  if (!LEAVE_KINDS.has(kind)) return { ok: false, error: 'Pick a leave type.' };
  if (!reason) return { ok: false, error: 'Please add a short reason.' };

  const days =
    Math.round(
      (new Date(`${toDate}T00:00:00Z`).getTime() - new Date(`${fromDate}T00:00:00Z`).getTime()) /
        86_400_000,
    ) + 1;
  if (days < 1 || days > 90)
    return { ok: false, error: 'Leave length looks off — check the dates.' };

  try {
    await db.insert(leaves).values({
      employeeId: me.id,
      kind: kind as LeaveKind,
      fromDate,
      toDate,
      days: String(days),
      status: 'applied',
      notes: reason,
    });
    return { ok: true };
  } catch (e) {
    console.error('[applyMyLeave] failed', e);
    return { ok: false, error: 'Couldn’t submit your leave. Please try again.' };
  }
}

/** The signed-in employee's own leaves (most recent first). Self-scoped. */
export async function listMyLeaves(): Promise<MyLeave[]> {
  const me = await currentEmployee();
  if (!me) return [];
  const rows = await db
    .select(leaveCols)
    .from(leaves)
    .where(and(eq(leaves.employeeId, me.id), isNull(leaves.deletedAt)))
    .orderBy(desc(leaves.fromDate))
    .limit(60);
  return rows.map((r) => ({ ...r, kind: r.kind as LeaveKind, status: r.status as LeaveStatus }));
}

/** Withdraw a still-pending leave. Self-scoped. */
export async function cancelMyLeave(id: string): Promise<EmployeeActionResult> {
  const me = await currentEmployee();
  if (!me) return { ok: false, error: 'Your session has expired. Sign in again.' };
  try {
    const [row] = await db
      .select({ status: leaves.status })
      .from(leaves)
      .where(and(eq(leaves.id, id), eq(leaves.employeeId, me.id), isNull(leaves.deletedAt)))
      .limit(1);
    if (!row) return { ok: false, error: 'Leave not found.' };
    if (row.status !== 'applied')
      return { ok: false, error: 'Only a pending leave can be cancelled.' };
    await db.update(leaves).set({ status: 'cancelled' }).where(eq(leaves.id, id));
    return { ok: true };
  } catch (e) {
    console.error('[cancelMyLeave] failed', e);
    return { ok: false, error: 'Couldn’t cancel the leave. Please try again.' };
  }
}

/** Pending leaves filed by the signed-in employee's DIRECT reports (manager
 * view). Empty for non-managers. Self-scoped. */
export async function listMyTeamLeaveRequests(): Promise<TeamLeaveRequest[]> {
  const me = await currentEmployee();
  if (!me) return [];
  const rows = await db
    .select({ ...leaveCols, employeeId: leaves.employeeId, employeeName: employees.fullName })
    .from(leaves)
    .innerJoin(employees, eq(employees.id, leaves.employeeId))
    .where(
      and(
        eq(employees.reportsToEmployeeId, me.id),
        eq(leaves.status, 'applied'),
        isNull(leaves.deletedAt),
      ),
    )
    .orderBy(desc(leaves.appliedAt))
    .limit(60);
  return rows.map((r) => ({ ...r, kind: r.kind as LeaveKind, status: r.status as LeaveStatus }));
}

/** Approve/reject a leave filed by one of the signed-in employee's direct
 * reports (manager decision). Verifies the report relationship. Self-scoped. */
export async function decideMyReportLeave(
  id: string,
  accept: boolean,
): Promise<EmployeeActionResult> {
  const me = await currentEmployee();
  if (!me) return { ok: false, error: 'Your session has expired. Sign in again.' };
  try {
    const [row] = await db
      .select({ status: leaves.status })
      .from(leaves)
      .innerJoin(employees, eq(employees.id, leaves.employeeId))
      .where(
        and(eq(leaves.id, id), eq(employees.reportsToEmployeeId, me.id), isNull(leaves.deletedAt)),
      )
      .limit(1);
    if (!row) return { ok: false, error: 'Request not found or not one of your reports’.' };
    if (row.status !== 'applied') return { ok: false, error: 'This request was already decided.' };
    // approvedBy is a users FK; a manager is an employee, so we record the
    // decision + timestamp only (not a users id).
    await db
      .update(leaves)
      .set({ status: accept ? 'approved' : 'rejected', approvedAt: new Date() })
      .where(eq(leaves.id, id));
    return { ok: true };
  } catch (e) {
    console.error('[decideMyReportLeave] failed', e);
    return { ok: false, error: 'Couldn’t update the request. Please try again.' };
  }
}
