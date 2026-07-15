'use server';

import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import {
  clients,
  deliverableCategories,
  employees,
  projectMembers,
  projectTaskAssignees,
  projectTasks,
  projectVendors,
  projects,
  vendors,
} from '@/lib/db/schema';
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
  /** Employee's department — lets the assignee picker group teammates (0073). */
  department: string | null;
  roleNote: string | null;
};

const ProjectMemberIdSchema = z.string().uuid();

export async function listProjectMembers(projectId: string): Promise<readonly ProjectMemberRow[]> {
  await getActorContext();
  const parsedProjectId = z.string().uuid().parse(projectId);

  const rows = await db
    .select({
      id: projectMembers.id,
      employeeId: projectMembers.employeeId,
      employeeName: employees.fullName,
      department: employees.department,
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
      department: r.department,
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
      department: employees.department,
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
    department: row.department,
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
/* Project vendors                                                            */
/* -------------------------------------------------------------------------- */

export type ProjectVendorRow = {
  id: string;
  vendorId: string;
  vendorName: string;
  role: string | null;
};

const ProjectVendorIdSchema = z.string().uuid();

export async function listProjectVendors(projectId: string): Promise<readonly ProjectVendorRow[]> {
  await getActorContext();
  const parsedProjectId = z.string().uuid().parse(projectId);

  const rows = await db
    .select({
      id: projectVendors.id,
      vendorId: projectVendors.vendorId,
      vendorName: vendors.name,
      role: projectVendors.role,
    })
    .from(projectVendors)
    .innerJoin(vendors, eq(vendors.id, projectVendors.vendorId))
    .where(eq(projectVendors.projectId, parsedProjectId))
    .orderBy(asc(vendors.name), asc(projectVendors.createdAt));

  return rows.map(
    (r): ProjectVendorRow => ({
      id: r.id,
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      role: r.role,
    }),
  );
}

const AddProjectVendorSchema = z.object({
  projectId: z.string().uuid(),
  vendorId: z.string().uuid(),
  role: z.string().max(500).nullable().optional(),
});

export async function addProjectVendor(input: {
  projectId: string;
  vendorId: string;
  role?: string | null;
}): Promise<ProjectVendorRow> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_client');
  const parsed = AddProjectVendorSchema.parse(input);
  const role = parsed.role?.trim() ? parsed.role.trim() : null;

  // Upsert-safe: ignore the UNIQUE(project_id, vendor_id) collision so a
  // repeat add is a no-op that still returns the existing row.
  const inserted = await db
    .insert(projectVendors)
    .values({
      projectId: parsed.projectId,
      vendorId: parsed.vendorId,
      role,
      createdBy: ctx.userId,
    })
    .onConflictDoNothing({
      target: [projectVendors.projectId, projectVendors.vendorId],
    })
    .returning({ id: projectVendors.id });

  const linkId =
    inserted[0]?.id ??
    (
      await db
        .select({ id: projectVendors.id })
        .from(projectVendors)
        .where(
          and(
            eq(projectVendors.projectId, parsed.projectId),
            eq(projectVendors.vendorId, parsed.vendorId),
          ),
        )
        .limit(1)
    )[0]?.id;

  if (!linkId) {
    throw new AppError('internal', 'project_vendors insert returned no row');
  }

  const [row] = await db
    .select({
      id: projectVendors.id,
      vendorId: projectVendors.vendorId,
      vendorName: vendors.name,
      role: projectVendors.role,
    })
    .from(projectVendors)
    .innerJoin(vendors, eq(vendors.id, projectVendors.vendorId))
    .where(eq(projectVendors.id, linkId))
    .limit(1);

  if (!row) {
    throw new AppError('not_found', 'Project vendor not found after insert.', {
      detail: { id: linkId },
    });
  }

  // Only log when a new link was actually created (not on a no-op).
  if (inserted.length > 0) {
    await logAudit({
      actorId: ctx.userId,
      entityType: 'project',
      entityId: parsed.projectId,
      action: 'insert',
      changes: {
        vendor_added: { id: linkId, vendor_id: parsed.vendorId, role },
      },
    });
  }

  return {
    id: row.id,
    vendorId: row.vendorId,
    vendorName: row.vendorName,
    role: row.role,
  };
}

export async function removeProjectVendor(input: { id: string }): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_client');
  const id = ProjectVendorIdSchema.parse(input.id);

  const [row] = await db
    .delete(projectVendors)
    .where(eq(projectVendors.id, id))
    .returning({ id: projectVendors.id, projectId: projectVendors.projectId });

  if (!row) return; // idempotent: already gone

  await logAudit({
    actorId: ctx.userId,
    entityType: 'project',
    entityId: row.projectId,
    action: 'delete',
    changes: { vendor_removed: { id } },
  });
}

/* -------------------------------------------------------------------------- */
/* Project deliverables (table: project_tasks)                                */
/* -------------------------------------------------------------------------- */

export type ProjectTaskStatus = 'todo' | 'in_progress' | 'done';

/** Eisenhower priority tag (0070). null = no priority set. */
export type ProjectTaskPriority = 'urgent_important' | 'urgent' | 'important' | 'nice';

/** Who the deliverable came from (0070). null on legacy rows. */
export type ProjectTaskSource = 'apar' | 'vendor';

const ProjectTaskStatusSchema = z.enum(['todo', 'in_progress', 'done']);
const ProjectTaskPrioritySchema = z.enum(['urgent_important', 'urgent', 'important', 'nice']);
const ProjectTaskSourceSchema = z.enum(['apar', 'vendor']);
const ProjectTaskIdSchema = z.string().uuid();

/**
 * A deliverable assignee — either an employee or a vendor (0073). Exactly one
 * of `employeeId` / `vendorId` is set; `kind` says which; `name` is the
 * employee's full name or the vendor's name.
 */
export type ProjectTaskAssignee = {
  employeeId: string | null;
  vendorId: string | null;
  name: string;
  kind: 'employee' | 'vendor';
};

export type ProjectTaskRow = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: ProjectTaskStatus;
  priority: ProjectTaskPriority | null;
  source: ProjectTaskSource | null;
  /** Multi-assignee (0061) — every employee working this deliverable. */
  assignees: readonly ProjectTaskAssignee[];
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  dueOn: string | null;
  position: number;
  completedAt: string | null;
  createdAt: string;
};

export async function listProjectTasks(projectId: string): Promise<readonly ProjectTaskRow[]> {
  await getActorContext();
  const parsedProjectId = z.string().uuid().parse(projectId);

  const rows = await db
    .select({
      id: projectTasks.id,
      projectId: projectTasks.projectId,
      title: projectTasks.title,
      description: projectTasks.description,
      status: projectTasks.status,
      priority: projectTasks.priority,
      source: projectTasks.source,
      categoryId: projectTasks.categoryId,
      categoryName: deliverableCategories.name,
      categoryColor: deliverableCategories.color,
      dueOn: projectTasks.dueOn,
      position: projectTasks.position,
      completedAt: projectTasks.completedAt,
      createdAt: projectTasks.createdAt,
    })
    .from(projectTasks)
    .leftJoin(deliverableCategories, eq(deliverableCategories.id, projectTasks.categoryId))
    .where(and(eq(projectTasks.projectId, parsedProjectId), isNull(projectTasks.deletedAt)))
    .orderBy(asc(projectTasks.position), asc(projectTasks.createdAt));

  const assigneesByTask = await loadAssignees(rows.map((r) => r.id));
  return rows.map((r) => mapTaskRow(r, assigneesByTask.get(r.id) ?? []));
}

const CreateProjectTaskSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(300),
  description: z.string().max(4000).nullable().optional(),
  assigneeEmployeeIds: z.array(z.string().uuid()).max(50).optional(),
  assigneeVendorIds: z.array(z.string().uuid()).max(50).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  priority: ProjectTaskPrioritySchema.nullable().optional(),
  source: ProjectTaskSourceSchema.nullable().optional(),
  dueOn: z.string().nullable().optional(),
  status: ProjectTaskStatusSchema.optional(),
});

export async function createProjectTask(input: {
  projectId: string;
  title: string;
  description?: string | null;
  assigneeEmployeeIds?: string[];
  assigneeVendorIds?: string[];
  categoryId?: string | null;
  priority?: ProjectTaskPriority | null;
  source?: ProjectTaskSource | null;
  dueOn?: string | null;
  status?: ProjectTaskStatus;
}): Promise<ProjectTaskRow> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_client');
  const parsed = CreateProjectTaskSchema.parse(input);
  const status = parsed.status ?? 'todo';
  const assigneeIds = [...new Set(parsed.assigneeEmployeeIds ?? [])];
  const vendorAssigneeIds = [...new Set(parsed.assigneeVendorIds ?? [])];

  const [inserted] = await db
    .insert(projectTasks)
    .values({
      projectId: parsed.projectId,
      title: parsed.title,
      description: parsed.description ?? null,
      status,
      categoryId: parsed.categoryId ?? null,
      priority: parsed.priority ?? null,
      // New deliverables default to 'apar' unless the caller says otherwise.
      source: parsed.source === undefined ? 'apar' : parsed.source,
      dueOn: parsed.dueOn ?? null,
      completedAt: status === 'done' ? new Date() : null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning({ id: projectTasks.id });

  if (!inserted) throw new AppError('internal', 'project_tasks insert returned no row');

  if (assigneeIds.length > 0) {
    await db
      .insert(projectTaskAssignees)
      .values(
        assigneeIds.map((employeeId) => ({
          taskId: inserted.id,
          employeeId,
          createdBy: ctx.userId,
        })),
      )
      .onConflictDoNothing({
        target: [projectTaskAssignees.taskId, projectTaskAssignees.employeeId],
      });
  }

  if (vendorAssigneeIds.length > 0) {
    await db
      .insert(projectTaskAssignees)
      .values(
        vendorAssigneeIds.map((vendorId) => ({
          taskId: inserted.id,
          vendorId,
          createdBy: ctx.userId,
        })),
      )
      // Vendor uniqueness lives in a PARTIAL index (WHERE vendor_id IS NOT
      // NULL), so the arbiter predicate must be repeated to match it.
      .onConflictDoNothing({
        target: [projectTaskAssignees.taskId, projectTaskAssignees.vendorId],
        where: sql`${projectTaskAssignees.vendorId} IS NOT NULL`,
      });
  }

  await logAudit({
    actorId: ctx.userId,
    entityType: 'project',
    entityId: parsed.projectId,
    action: 'insert',
    changes: {
      task_created: {
        id: inserted.id,
        title: parsed.title,
        status,
        assignees: assigneeIds,
        vendorAssignees: vendorAssigneeIds,
      },
    },
  });

  return await getTaskRow(inserted.id);
}

const UpdateProjectTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(4000).nullable().optional(),
  assigneeEmployeeIds: z.array(z.string().uuid()).max(50).optional(),
  assigneeVendorIds: z.array(z.string().uuid()).max(50).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  priority: ProjectTaskPrioritySchema.nullable().optional(),
  source: ProjectTaskSourceSchema.nullable().optional(),
  dueOn: z.string().nullable().optional(),
  status: ProjectTaskStatusSchema.optional(),
});

export async function updateProjectTask(input: {
  id: string;
  title?: string;
  description?: string | null;
  assigneeEmployeeIds?: string[];
  assigneeVendorIds?: string[];
  categoryId?: string | null;
  priority?: ProjectTaskPriority | null;
  source?: ProjectTaskSource | null;
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
      ...(parsed.categoryId !== undefined ? { categoryId: parsed.categoryId } : {}),
      ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
      ...(parsed.source !== undefined ? { source: parsed.source } : {}),
      ...(parsed.dueOn !== undefined ? { dueOn: parsed.dueOn } : {}),
      ...(parsed.status !== undefined ? { status: parsed.status } : {}),
      ...completedAtPatch,
      updatedBy: ctx.userId,
    })
    .where(and(eq(projectTasks.id, parsed.id), isNull(projectTasks.deletedAt)));

  // Replace-set assignee semantics, per kind: the provided list becomes THE
  // list for that kind. `undefined` leaves that kind untouched — passing only
  // employee ids never disturbs vendor rows and vice-versa (0073).
  if (parsed.assigneeEmployeeIds !== undefined) {
    const next = [...new Set(parsed.assigneeEmployeeIds)];
    const current = await db
      .select({ employeeId: projectTaskAssignees.employeeId })
      .from(projectTaskAssignees)
      .where(
        and(eq(projectTaskAssignees.taskId, parsed.id), isNotNull(projectTaskAssignees.employeeId)),
      );
    const currentIds = new Set(current.map((r) => r.employeeId).filter((id): id is string => !!id));
    const toAdd = next.filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !next.includes(id));
    if (toAdd.length > 0) {
      await db
        .insert(projectTaskAssignees)
        .values(
          toAdd.map((employeeId) => ({ taskId: parsed.id, employeeId, createdBy: ctx.userId })),
        )
        .onConflictDoNothing({
          target: [projectTaskAssignees.taskId, projectTaskAssignees.employeeId],
        });
    }
    if (toRemove.length > 0) {
      await db
        .delete(projectTaskAssignees)
        .where(
          and(
            eq(projectTaskAssignees.taskId, parsed.id),
            inArray(projectTaskAssignees.employeeId, toRemove),
          ),
        );
    }
  }

  if (parsed.assigneeVendorIds !== undefined) {
    const next = [...new Set(parsed.assigneeVendorIds)];
    const current = await db
      .select({ vendorId: projectTaskAssignees.vendorId })
      .from(projectTaskAssignees)
      .where(
        and(eq(projectTaskAssignees.taskId, parsed.id), isNotNull(projectTaskAssignees.vendorId)),
      );
    const currentIds = new Set(current.map((r) => r.vendorId).filter((id): id is string => !!id));
    const toAdd = next.filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !next.includes(id));
    if (toAdd.length > 0) {
      await db
        .insert(projectTaskAssignees)
        .values(toAdd.map((vendorId) => ({ taskId: parsed.id, vendorId, createdBy: ctx.userId })))
        // Vendor uniqueness is a PARTIAL index — repeat its predicate.
        .onConflictDoNothing({
          target: [projectTaskAssignees.taskId, projectTaskAssignees.vendorId],
          where: sql`${projectTaskAssignees.vendorId} IS NOT NULL`,
        });
    }
    if (toRemove.length > 0) {
      await db
        .delete(projectTaskAssignees)
        .where(
          and(
            eq(projectTaskAssignees.taskId, parsed.id),
            inArray(projectTaskAssignees.vendorId, toRemove),
          ),
        );
    }
  }

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
  clientName: string;
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
      clientName: clients.name,
      roleNote: projectMembers.roleNote,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(projectMembers.employeeId, parsedEmployeeId), eq(projects.isArchived, false)))
    .orderBy(asc(projects.name));

  return rows.map(
    (r): EmployeeProjectMembershipRow => ({
      memberId: r.memberId,
      projectId: r.projectId,
      projectName: r.projectName,
      projectCode: r.projectCode,
      projectStatus: r.projectStatus,
      clientName: r.clientName,
      roleNote: r.roleNote,
    }),
  );
}

export type EmployeeProjectTaskRow = {
  taskId: string;
  title: string;
  status: ProjectTaskStatus;
  priority: ProjectTaskPriority | null;
  source: ProjectTaskSource | null;
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
          where a.task_id = ${projectTasks.id} and a.employee_id = ${parsedEmployeeId}
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

/**
 * Deliverables handed over to a VENDOR — i.e. assigned to them via
 * project_task_assignees.vendorId (0073), the "handover" the founder brief
 * describes (§6.5). Same shape + ordering as the employee list; backs the
 * vendor window's Priorities tab (§6.3, Pending vs Completed).
 */
export type VendorProjectTaskRow = EmployeeProjectTaskRow;

export async function listVendorProjectTasks(
  vendorId: string,
): Promise<readonly VendorProjectTaskRow[]> {
  await getActorContext();
  const parsedVendorId = z.string().uuid().parse(vendorId);

  const statusOrder = sql<number>`case ${projectTasks.status}
    when 'todo' then 0 when 'in_progress' then 1 when 'done' then 2 else 3 end`;

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
        sql`exists (
          select 1 from project_task_assignees a
          where a.task_id = ${projectTasks.id} and a.vendor_id = ${parsedVendorId}
        )`,
        isNull(projectTasks.deletedAt),
      ),
    )
    .orderBy(asc(statusOrder), desc(projectTasks.updatedAt));

  return rows.map(
    (r): VendorProjectTaskRow => ({
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

/* -------------------------------------------------------------------------- */
/* Internal helpers (not exported — 'use server' allows only async exports)   */
/* -------------------------------------------------------------------------- */

type TaskSelectRow = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  source: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  dueOn: string | null;
  position: number;
  completedAt: Date | null;
  createdAt: Date;
};

function mapTaskRow(r: TaskSelectRow, assignees: readonly ProjectTaskAssignee[]): ProjectTaskRow {
  return {
    id: r.id,
    projectId: r.projectId,
    title: r.title,
    description: r.description,
    status: r.status as ProjectTaskStatus,
    priority: (r.priority as ProjectTaskPriority | null) ?? null,
    source: (r.source as ProjectTaskSource | null) ?? null,
    assignees,
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    categoryColor: r.categoryColor,
    dueOn: r.dueOn,
    position: r.position,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Batch-load assignees for a set of tasks; one query, grouped in JS. Each row
 * points at either an employee or a vendor (0073), so both are LEFT-joined —
 * an inner join on employees would DROP every vendor assignee. `name` is the
 * employee full name or the vendor name; `kind` follows whichever id is set.
 */
async function loadAssignees(
  taskIds: readonly string[],
): Promise<Map<string, ProjectTaskAssignee[]>> {
  const out = new Map<string, ProjectTaskAssignee[]>();
  if (taskIds.length === 0) return out;
  const sortName = sql<string>`coalesce(${employees.fullName}, ${vendors.name})`;
  const rows = await db
    .select({
      taskId: projectTaskAssignees.taskId,
      employeeId: projectTaskAssignees.employeeId,
      vendorId: projectTaskAssignees.vendorId,
      employeeName: employees.fullName,
      vendorName: vendors.name,
    })
    .from(projectTaskAssignees)
    .leftJoin(employees, eq(employees.id, projectTaskAssignees.employeeId))
    .leftJoin(vendors, eq(vendors.id, projectTaskAssignees.vendorId))
    .where(inArray(projectTaskAssignees.taskId, taskIds as string[]))
    .orderBy(asc(sortName));
  for (const r of rows) {
    const list = out.get(r.taskId) ?? [];
    if (r.vendorId) {
      list.push({
        employeeId: null,
        vendorId: r.vendorId,
        name: r.vendorName ?? 'Unknown vendor',
        kind: 'vendor',
      });
    } else if (r.employeeId) {
      list.push({
        employeeId: r.employeeId,
        vendorId: null,
        name: r.employeeName ?? 'Unknown',
        kind: 'employee',
      });
    }
    out.set(r.taskId, list);
  }
  return out;
}

async function getTaskRow(id: string): Promise<ProjectTaskRow> {
  const [row] = await db
    .select({
      id: projectTasks.id,
      projectId: projectTasks.projectId,
      title: projectTasks.title,
      description: projectTasks.description,
      status: projectTasks.status,
      priority: projectTasks.priority,
      source: projectTasks.source,
      categoryId: projectTasks.categoryId,
      categoryName: deliverableCategories.name,
      categoryColor: deliverableCategories.color,
      dueOn: projectTasks.dueOn,
      position: projectTasks.position,
      completedAt: projectTasks.completedAt,
      createdAt: projectTasks.createdAt,
    })
    .from(projectTasks)
    .leftJoin(deliverableCategories, eq(deliverableCategories.id, projectTasks.categoryId))
    .where(eq(projectTasks.id, id))
    .limit(1);

  if (!row) throw new AppError('not_found', 'Task not found.', { detail: { id } });
  const assignees = await loadAssignees([row.id]);
  return mapTaskRow(row, assignees.get(row.id) ?? []);
}
