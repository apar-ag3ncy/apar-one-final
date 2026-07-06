'use server';

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import { employees, projectMembers, projectTasks, projects } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

/**
 * Project members + project tasks — the collaboration surface layered on top
 * of a project. Mirrors projects.ts for the capability + AppError + audit
 * patterns.
 *
 * There is no dedicated `project_task`/`project_member` capability in
 * lib/rbac.ts, so — like projects.ts does for project lifecycle — writes here
 * reuse `update_client`: a project belongs to a client, and authority over a
 * client's projects implies authority over their members/tasks. Reads only
 * establish an actor context (getActorContext()).
 *
 * These are project sub-resources, so audit entries are keyed to the parent
 * project (entityType 'project'). `entity_activity_log` has no task/member
 * event kind (adding one needs a schema + migration round-trip), so member/
 * task mutations are recorded via the diff-trail `logAudit` only.
 */

/* -------------------------------------------------------------------------- */
/* Project members                                                            */
/* -------------------------------------------------------------------------- */

export type ProjectMemberRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  roleNote: string | null;
};

const ProjectMemberIdSchema = z.string().uuid();

export async function listProjectMembers(
  projectId: string,
): Promise<readonly ProjectMemberRow[]> {
  await getActorContext();
  const parsedProjectId = z.string().uuid().parse(projectId);

  const rows = await db
    .select({
      id: projectMembers.id,
      employeeId: projectMembers.employeeId,
      employeeName: employees.fullName,
      roleNote: projectMembers.roleNote,
    })
    .from(projectMembers)
    .innerJoin(employees, eq(employees.id, projectMembers.employeeId))
    .where(eq(projectMembers.projectId, parsedProjectId))
    .orderBy(asc(employees.fullName), asc(projectMembers.createdAt));

  return rows.map(
    (r): ProjectMemberRow => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      roleNote: r.roleNote,
    }),
  );
}

const AddProjectMemberSchema = z.object({
  projectId: z.string().uuid(),
  employeeId: z.string().uuid(),
  roleNote: z.string().max(500).nullable().optional(),
});

export async function addProjectMember(input: {
  projectId: string;
  employeeId: string;
  roleNote?: string | null;
}): Promise<ProjectMemberRow> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_client');
  const parsed = AddProjectMemberSchema.parse(input);
  const roleNote = parsed.roleNote ?? null;

  // Upsert-safe: ignore the UNIQUE(project_id, employee_id) collision so a
  // repeat add is a no-op that still returns the existing row.
  const inserted = await db
    .insert(projectMembers)
    .values({
      projectId: parsed.projectId,
      employeeId: parsed.employeeId,
      roleNote,
      createdBy: ctx.userId,
    })
    .onConflictDoNothing({
      target: [projectMembers.projectId, projectMembers.employeeId],
    })
    .returning({ id: projectMembers.id });

  const memberId =
    inserted[0]?.id ??
    (
      await db
        .select({ id: projectMembers.id })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, parsed.projectId),
            eq(projectMembers.employeeId, parsed.employeeId),
          ),
        )
        .limit(1)
    )[0]?.id;

  if (!memberId) {
    throw new AppError('internal', 'project_members insert returned no row');
  }

  const [row] = await db
    .select({
      id: projectMembers.id,
      employeeId: projectMembers.employeeId,
      employeeName: employees.fullName,
      roleNote: projectMembers.roleNote,
    })
    .from(projectMembers)
    .innerJoin(employees, eq(employees.id, projectMembers.employeeId))
    .where(eq(projectMembers.id, memberId))
    .limit(1);

  if (!row) {
    throw new AppError('not_found', 'Project member not found after insert.', {
      detail: { id: memberId },
    });
  }

  // Only log when a new membership was actually created (not on a no-op).
  if (inserted.length > 0) {
    await logAudit({
      actorId: ctx.userId,
      entityType: 'project',
      entityId: parsed.projectId,
      action: 'insert',
      changes: {
        member_added: { id: memberId, employee_id: parsed.employeeId, role_note: roleNote },
      },
    });
  }

  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    roleNote: row.roleNote,
  };
}

export async function removeProjectMember(input: { id: string }): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_client');
  const id = ProjectMemberIdSchema.parse(input.id);

  const [row] = await db
    .delete(projectMembers)
    .where(eq(projectMembers.id, id))
    .returning({ id: projectMembers.id, projectId: projectMembers.projectId });

  if (!row) return; // idempotent: already gone

  await logAudit({
    actorId: ctx.userId,
    entityType: 'project',
    entityId: row.projectId,
    action: 'delete',
    changes: { member_removed: { id } },
  });
}

/* -------------------------------------------------------------------------- */
/* Project tasks                                                              */
/* -------------------------------------------------------------------------- */

export type ProjectTaskStatus = 'todo' | 'in_progress' | 'done';

const ProjectTaskStatusSchema = z.enum(['todo', 'in_progress', 'done']);
const ProjectTaskIdSchema = z.string().uuid();

export type ProjectTaskRow = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: ProjectTaskStatus;
  assigneeEmployeeId: string | null;
  assigneeName: string | null;
  dueOn: string | null;
  position: number;
  completedAt: string | null;
  createdAt: string;
};

export async function listProjectTasks(
  projectId: string,
): Promise<readonly ProjectTaskRow[]> {
  await getActorContext();
  const parsedProjectId = z.string().uuid().parse(projectId);

  const rows = await db
    .select({
      id: projectTasks.id,
      projectId: projectTasks.projectId,
      title: projectTasks.title,
      description: projectTasks.description,
      status: projectTasks.status,
      assigneeEmployeeId: projectTasks.assigneeEmployeeId,
      assigneeName: employees.fullName,
      dueOn: projectTasks.dueOn,
      position: projectTasks.position,
      completedAt: projectTasks.completedAt,
      createdAt: projectTasks.createdAt,
    })
    .from(projectTasks)
    .leftJoin(employees, eq(employees.id, projectTasks.assigneeEmployeeId))
    .where(and(eq(projectTasks.projectId, parsedProjectId), isNull(projectTasks.deletedAt)))
    .orderBy(asc(projectTasks.position), asc(projectTasks.createdAt));

  return rows.map((r) => mapTaskRow(r));
}

const CreateProjectTaskSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(300),
  description: z.string().max(4000).nullable().optional(),
  assigneeEmployeeId: z.string().uuid().nullable().optional(),
  dueOn: z.string().nullable().optional(),
  status: ProjectTaskStatusSchema.optional(),
});

export async function createProjectTask(input: {
  projectId: string;
  title: string;
  description?: string | null;
  assigneeEmployeeId?: string | null;
  dueOn?: string | null;
  status?: ProjectTaskStatus;
}): Promise<ProjectTaskRow> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_client');
  const parsed = CreateProjectTaskSchema.parse(input);
  const status = parsed.status ?? 'todo';

  const [inserted] = await db
    .insert(projectTasks)
    .values({
      projectId: parsed.projectId,
      title: parsed.title,
      description: parsed.description ?? null,
      status,
      assigneeEmployeeId: parsed.assigneeEmployeeId ?? null,
      dueOn: parsed.dueOn ?? null,
      completedAt: status === 'done' ? new Date() : null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning({ id: projectTasks.id });

  if (!inserted) throw new AppError('internal', 'project_tasks insert returned no row');

  await logAudit({
    actorId: ctx.userId,
    entityType: 'project',
    entityId: parsed.projectId,
    action: 'insert',
    changes: { task_created: { id: inserted.id, title: parsed.title, status } },
  });

  return await getTaskRow(inserted.id);
}

const UpdateProjectTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(4000).nullable().optional(),
  assigneeEmployeeId: z.string().uuid().nullable().optional(),
  dueOn: z.string().nullable().optional(),
  status: ProjectTaskStatusSchema.optional(),
});

export async function updateProjectTask(input: {
  id: string;
  title?: string;
  description?: string | null;
  assigneeEmployeeId?: string | null;
  dueOn?: string | null;
  status?: ProjectTaskStatus;
}): Promise<ProjectTaskRow> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_client');
  const parsed = UpdateProjectTaskSchema.parse(input);

  const [existing] = await db
    .select({ status: projectTasks.status, projectId: projectTasks.projectId })
    .from(projectTasks)
    .where(and(eq(projectTasks.id, parsed.id), isNull(projectTasks.deletedAt)))
    .limit(1);

  if (!existing) {
    throw new AppError('not_found', 'Task not found.', { detail: { id: parsed.id } });
  }

  // completed_at follows the 'done' status: set on entry, clear on exit.
  let completedAtPatch: { completedAt: Date | null } | Record<string, never> = {};
  if (parsed.status !== undefined && parsed.status !== existing.status) {
    if (parsed.status === 'done') {
      completedAtPatch = { completedAt: new Date() };
    } else if (existing.status === 'done') {
      completedAtPatch = { completedAt: null };
    }
  }

  await db
    .update(projectTasks)
    .set({
      ...(parsed.title !== undefined ? { title: parsed.title } : {}),
      ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      ...(parsed.assigneeEmployeeId !== undefined
        ? { assigneeEmployeeId: parsed.assigneeEmployeeId }
        : {}),
      ...(parsed.dueOn !== undefined ? { dueOn: parsed.dueOn } : {}),
      ...(parsed.status !== undefined ? { status: parsed.status } : {}),
      ...completedAtPatch,
      updatedBy: ctx.userId,
    })
    .where(and(eq(projectTasks.id, parsed.id), isNull(projectTasks.deletedAt)));

  const { id: _id, ...changes } = parsed;
  await logAudit({
    actorId: ctx.userId,
    entityType: 'project',
    entityId: existing.projectId,
    action: 'update',
    changes: { task_updated: { id: parsed.id, ...(changes as Record<string, unknown>) } },
  });

  return await getTaskRow(parsed.id);
}

export async function deleteProjectTask(input: { id: string }): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_client');
  const id = ProjectTaskIdSchema.parse(input.id);

  const [row] = await db
    .update(projectTasks)
    .set({ deletedAt: new Date(), updatedBy: ctx.userId })
    .where(and(eq(projectTasks.id, id), isNull(projectTasks.deletedAt)))
    .returning({ id: projectTasks.id, projectId: projectTasks.projectId });

  if (!row) return; // idempotent: already deleted / absent

  await logAudit({
    actorId: ctx.userId,
    entityType: 'project',
    entityId: row.projectId,
    action: 'delete',
    changes: { task_deleted: { id } },
  });
}

/* -------------------------------------------------------------------------- */
/* Employee-facing view                                                       */
/* -------------------------------------------------------------------------- */

export type EmployeeProjectMembershipRow = {
  memberId: string;
  projectId: string;
  projectName: string;
  projectCode: string | null;
  projectStatus: string;
  roleNote: string | null;
};

/**
 * Projects this employee is a team member on (via project_members). The
 * employee window renders these beside "Projects led" so adding a team mate
 * in the project window is immediately visible from the Employees app too.
 */
export async function listEmployeeProjects(
  employeeId: string,
): Promise<readonly EmployeeProjectMembershipRow[]> {
  await getActorContext();
  const parsedEmployeeId = z.string().uuid().parse(employeeId);

  const rows = await db
    .select({
      memberId: projectMembers.id,
      projectId: projectMembers.projectId,
      projectName: projects.name,
      projectCode: projects.code,
      projectStatus: projects.status,
      roleNote: projectMembers.roleNote,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(eq(projectMembers.employeeId, parsedEmployeeId), eq(projects.isArchived, false)))
    .orderBy(asc(projects.name));

  return rows.map(
    (r): EmployeeProjectMembershipRow => ({
      memberId: r.memberId,
      projectId: r.projectId,
      projectName: r.projectName,
      projectCode: r.projectCode,
      projectStatus: r.projectStatus,
      roleNote: r.roleNote,
    }),
  );
}

export type EmployeeProjectTaskRow = {
  taskId: string;
  title: string;
  status: ProjectTaskStatus;
  projectId: string;
  projectName: string;
  projectCode: string | null;
  dueOn: string | null;
  completedAt: string | null;
};

export async function listEmployeeProjectTasks(
  employeeId: string,
): Promise<readonly EmployeeProjectTaskRow[]> {
  await getActorContext();
  const parsedEmployeeId = z.string().uuid().parse(employeeId);

  // Order by status (todo → in_progress → done) then most-recently touched.
  const statusOrder = sql<number>`case ${projectTasks.status}
    when 'todo' then 0 when 'in_progress' then 1 when 'done' then 2 else 3 end`;

  const rows = await db
    .select({
      taskId: projectTasks.id,
      title: projectTasks.title,
      status: projectTasks.status,
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
        eq(projectTasks.assigneeEmployeeId, parsedEmployeeId),
        isNull(projectTasks.deletedAt),
      ),
    )
    .orderBy(asc(statusOrder), desc(projectTasks.updatedAt));

  return rows.map(
    (r): EmployeeProjectTaskRow => ({
      taskId: r.taskId,
      title: r.title,
      status: r.status as ProjectTaskStatus,
      projectId: r.projectId,
      projectName: r.projectName,
      projectCode: r.projectCode,
      dueOn: r.dueOn,
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Internal helpers (not exported — 'use server' allows only async exports)   */
/* -------------------------------------------------------------------------- */

type TaskSelectRow = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: string;
  assigneeEmployeeId: string | null;
  assigneeName: string | null;
  dueOn: string | null;
  position: number;
  completedAt: Date | null;
  createdAt: Date;
};

function mapTaskRow(r: TaskSelectRow): ProjectTaskRow {
  return {
    id: r.id,
    projectId: r.projectId,
    title: r.title,
    description: r.description,
    status: r.status as ProjectTaskStatus,
    assigneeEmployeeId: r.assigneeEmployeeId,
    assigneeName: r.assigneeName,
    dueOn: r.dueOn,
    position: r.position,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

async function getTaskRow(id: string): Promise<ProjectTaskRow> {
  const [row] = await db
    .select({
      id: projectTasks.id,
      projectId: projectTasks.projectId,
      title: projectTasks.title,
      description: projectTasks.description,
      status: projectTasks.status,
      assigneeEmployeeId: projectTasks.assigneeEmployeeId,
      assigneeName: employees.fullName,
      dueOn: projectTasks.dueOn,
      position: projectTasks.position,
      completedAt: projectTasks.completedAt,
      createdAt: projectTasks.createdAt,
    })
    .from(projectTasks)
    .leftJoin(employees, eq(employees.id, projectTasks.assigneeEmployeeId))
    .where(eq(projectTasks.id, id))
    .limit(1);

  if (!row) throw new AppError('not_found', 'Task not found.', { detail: { id } });
  return mapTaskRow(row);
}
