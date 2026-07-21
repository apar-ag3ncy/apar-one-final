'use server';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import { projectTasks, projects } from '@/lib/db/schema';
import { getActorContext } from '@/lib/server/actor';
import { requirePortalEmployee } from '@/lib/server/portal/session';

/**
 * Let an employee move one of THEIR OWN deliverables along.
 *
 * Every write in `entities/project-tasks.ts` is gated on `update_client` —
 * there is no task-level capability. Granting that to the employee role so the
 * portal could work would also hand every employee the ability to edit clients,
 * so instead this action uses an OWNERSHIP check: the update only touches rows
 * that (a) are the named task and (b) have an assignee row pointing at the
 * caller's own employee id. The ownership predicate lives in the UPDATE's WHERE
 * clause, so it is enforced by the database in the same statement — there is no
 * check-then-write window.
 *
 * Scope is deliberately narrow: status only. Title, assignees, due dates and
 * deletion stay with the OS.
 */

// The 6 real statuses. `little_delayed`/`delayed` are OPEN states that do not
// stamp completedAt; `cancelled` is closed but not completed.
const StatusEnum = z.enum([
  'todo',
  'in_progress',
  'little_delayed',
  'delayed',
  'done',
  'cancelled',
]);

export async function updateMyTaskStatus(input: {
  taskId: string;
  status: z.infer<typeof StatusEnum>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // Two different identities, on purpose:
  //   me.employeeId — an `employees.id`, used for the OWNERSHIP predicate.
  //   ctx.userId    — a `users.id`, the only thing that may go in the
  //                   created_by/updated_by/actor_id columns (they are users.id
  //                   FKs; for an OS session this is the system sentinel).
  // Writing an employee uuid into those columns would be a foreign-key
  // violation, so the real actor is recorded in the audit payload instead.
  const me = await requirePortalEmployee();
  const ctx = await getActorContext();

  const parsed = z
    .object({ taskId: z.string().uuid(), status: StatusEnum })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'That is not a valid status.' };

  const { taskId, status } = parsed.data;

  // Read the current row, already ownership-scoped, so we know whether
  // completed_at needs to change and can give a precise error.
  const [existing] = await db
    .select({ id: projectTasks.id, status: projectTasks.status })
    .from(projectTasks)
    .innerJoin(projects, eq(projects.id, projectTasks.projectId))
    .where(
      and(
        eq(projectTasks.id, taskId),
        isNull(projectTasks.deletedAt),
        isNull(projects.deletedAt),
        eq(projects.isArchived, false),
        sql`exists (
          select 1 from project_task_assignees a
          where a.task_id = ${projectTasks.id} and a.employee_id = ${me.employeeId}
        )`,
      ),
    )
    .limit(1);

  // Same message whether the task doesn't exist or isn't theirs — the portal
  // must not confirm the existence of other people's work.
  if (!existing) return { ok: false, error: 'That task is not assigned to you.' };
  if (existing.status === status) return { ok: true };

  // completed_at follows 'done': set on entry, clear on exit (mirrors
  // updateProjectTask in entities/project-tasks.ts).
  const completedAtPatch =
    status === 'done'
      ? { completedAt: new Date() }
      : existing.status === 'done'
        ? { completedAt: null }
        : {};

  const updated = await db
    .update(projectTasks)
    .set({ status, ...completedAtPatch, updatedBy: ctx.userId })
    .where(
      and(
        eq(projectTasks.id, taskId),
        isNull(projectTasks.deletedAt),
        // Ownership re-asserted in the write itself.
        sql`exists (
          select 1 from project_task_assignees a
          where a.task_id = ${projectTasks.id} and a.employee_id = ${me.employeeId}
        )`,
      ),
    )
    .returning({ id: projectTasks.id });

  if (updated.length === 0) return { ok: false, error: 'That task is not assigned to you.' };

  await logAudit({
    actorId: ctx.userId,
    entityType: 'project',
    entityId: taskId,
    action: 'update',
    changes: {
      status: { before: existing.status, after: status },
      // actor_id is the system sentinel for OS/portal sessions, so name the
      // real person here or the trail cannot attribute the change.
      portal_actor_employee_id: me.employeeId,
    },
  });

  return { ok: true };
}
