import 'server-only';

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { clients, projectTasks, projects } from '@/lib/db/schema';

import { requirePortalEmployee } from './session';

/**
 * "My tasks", grouped client → project → task.
 *
 * Adapted from `listEmployeeProjectTasks` rather than calling it, because that
 * one (a) takes a caller-supplied employeeId with no ownership check, (b) never
 * joins `clients`, so the client level of the tree isn't available, and (c)
 * filters neither `projects.deletedAt` nor `projects.isArchived`, so it happily
 * returns work on deleted and archived projects.
 *
 * Assignment lives in `project_task_assignees` (0061). `projectTasks.assigneeEmployeeId`
 * is the LEGACY single-assignee column — it still exists in prod but is neither
 * read nor written, so querying it would silently return only legacy rows. The
 * join table also holds VENDOR assignees (a row points at an employee OR a
 * vendor, DB CHECK num_nonnulls = 1); matching on `employee_id` inherently
 * excludes those.
 */

/** Open = still needs doing. `little_delayed`/`delayed` are OPEN, not closed. */
const OPEN_STATUSES = new Set(['todo', 'in_progress', 'little_delayed', 'delayed']);

export function isOpenStatus(status: string): boolean {
  return OPEN_STATUSES.has(status);
}

export type MyTask = {
  taskId: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  dueOn: string | null;
  completedAt: Date | null;
};

export type MyTaskProject = {
  projectId: string;
  name: string;
  code: string | null;
  /** Set when this is a sub-project, so the tree shows "Parent › Sub". */
  parentName: string | null;
  tasks: MyTask[];
};

export type MyTaskClient = {
  clientId: string;
  clientName: string;
  projects: MyTaskProject[];
};

export type MyTaskBoard = {
  clients: MyTaskClient[];
  openCount: number;
  totalCount: number;
};

export async function getMyTaskBoard(): Promise<MyTaskBoard> {
  const me = await requirePortalEmployee();

  // todo → in_progress → little_delayed → delayed → done → cancelled, matching
  // the OS board's ordering so the two surfaces agree.
  const statusOrder = sql<number>`case ${projectTasks.status}
    when 'todo' then 0 when 'in_progress' then 1
    when 'little_delayed' then 2 when 'delayed' then 3
    when 'done' then 4 when 'cancelled' then 5 else 6 end`;

  const rows = await db
    .select({
      taskId: projectTasks.id,
      title: projectTasks.title,
      description: projectTasks.description,
      status: projectTasks.status,
      priority: projectTasks.priority,
      dueOn: projectTasks.dueOn,
      completedAt: projectTasks.completedAt,
      projectId: projects.id,
      projectName: projects.name,
      projectCode: projects.code,
      parentProjectId: projects.parentProjectId,
      clientId: clients.id,
      clientName: clients.name,
    })
    .from(projectTasks)
    .innerJoin(projects, eq(projects.id, projectTasks.projectId))
    // projects.clientId is NOT NULL and sub-project client inheritance is
    // trigger-enforced, so the client is always exactly two joins away.
    //
    // The parent project is resolved in a second query rather than an aliased
    // self-join: adding `aliasedTable(projects, …)` to a SELECT this wide tips
    // Drizzle's type inference over its complexity limit and the whole row type
    // silently degrades to `never`.
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(
      and(
        sql`exists (
          select 1 from project_task_assignees a
          where a.task_id = ${projectTasks.id} and a.employee_id = ${me.employeeId}
        )`,
        isNull(projectTasks.deletedAt),
        // Deliberate, and NOT done by the OS query: work on a deleted or
        // archived project is not work anyone should be shown.
        isNull(projects.deletedAt),
        eq(projects.isArchived, false),
        isNull(clients.deletedAt),
      ),
    )
    .orderBy(asc(statusOrder), asc(projectTasks.dueOn), desc(projectTasks.updatedAt));

  // Resolve sub-project parents so the tree can show "Parent › Sub" rather than
  // listing a sub-project as if it were a separate top-level project.
  const parentIds = [...new Set(rows.map((r) => r.parentProjectId).filter((id): id is string => !!id))];
  const parentNameById = new Map<string, string>();
  if (parentIds.length > 0) {
    const parentRows = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(inArray(projects.id, parentIds));
    for (const p of parentRows) parentNameById.set(p.id, p.name);
  }

  // Group into client → project → task, preserving the SQL ordering.
  const byClient = new Map<string, MyTaskClient>();
  let openCount = 0;

  for (const r of rows) {
    if (isOpenStatus(r.status)) openCount += 1;

    let client = byClient.get(r.clientId);
    if (!client) {
      client = { clientId: r.clientId, clientName: r.clientName, projects: [] };
      byClient.set(r.clientId, client);
    }

    let project = client.projects.find((p) => p.projectId === r.projectId);
    if (!project) {
      project = {
        projectId: r.projectId,
        name: r.projectName,
        code: r.projectCode,
        parentName: r.parentProjectId ? (parentNameById.get(r.parentProjectId) ?? null) : null,
        tasks: [],
      };
      client.projects.push(project);
    }

    project.tasks.push({
      taskId: r.taskId,
      title: r.title,
      description: r.description,
      status: r.status,
      priority: r.priority,
      dueOn: r.dueOn,
      completedAt: r.completedAt,
    });
  }

  return {
    clients: [...byClient.values()],
    openCount,
    totalCount: rows.length,
  };
}
