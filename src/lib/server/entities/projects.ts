'use server';

import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logActivity } from '@/lib/activity';
import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import { clients, employees, projects, transactions } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

/**
 * Project write actions. Mirrors clients.ts / vendors.ts / employees.ts.
 *
 * No `archive_project` / `restore_project` / `hard_delete_project` capability
 * exists in `lib/rbac.ts` yet — per SPEC-AMENDMENT-001 §2.3 + §11, project
 * lifecycle reuses the *client* capabilities (a project belongs to a client,
 * and admin/partner authority over a client implies the same over its
 * projects). Match `contacts.ts` which already takes this stance for the
 * polymorphic-project case.
 */

const ProjectIdSchema = z.string().uuid();

export async function archiveProject(id: string): Promise<void> {
  await archiveProjects([id]);
}

export async function archiveProjects(ids: readonly string[]): Promise<void> {
  const ctx = await getActorContext();
  // Borrow archive_client per the §2.3 + §11 note above — partner short-
  // circuits anyway, so the only effect is gating admin/manager.
  requireCapability(ctx, 'archive_client');
  const parsed = ids.map((v) => ProjectIdSchema.parse(v));
  if (parsed.length === 0) return;

  await db
    .update(projects)
    .set({
      isArchived: true,
      archivedAt: new Date(),
      archivedBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .where(
      and(
        inArray(projects.id, parsed as string[]),
        eq(projects.isArchived, false),
        isNull(projects.deletedAt),
      ),
    );

  for (const id of parsed) {
    await logAudit({
      actorId: ctx.userId,
      entityType: 'project',
      entityId: id,
      action: 'update',
      changes: { isArchived: { before: false, after: true } },
    });
    await logActivity({
      entityType: 'project',
      entityId: id,
      actorId: ctx.userId,
      kind: 'entity.archived',
      summary: 'Project archived',
    });
  }
}

export async function restoreProject(id: string): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'restore_client');

  await db
    .update(projects)
    .set({
      isArchived: false,
      archivedAt: null,
      archivedBy: null,
      updatedBy: ctx.userId,
    })
    .where(and(eq(projects.id, id), isNull(projects.deletedAt)));

  await logAudit({
    actorId: ctx.userId,
    entityType: 'project',
    entityId: id,
    action: 'update',
    changes: { isArchived: { before: true, after: false } },
  });
  await logActivity({
    entityType: 'project',
    entityId: id,
    actorId: ctx.userId,
    kind: 'entity.restored',
    summary: 'Project restored',
  });
}

export async function hardDeleteProject(id: string): Promise<void> {
  const ctx = await getActorContext();
  if (ctx.role !== 'partner') {
    throw new AppError('forbidden', 'Hard delete of a project is restricted to the partner role.', {
      detail: { role: ctx.role },
    });
  }

  const refs = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.projectId, id), ne(transactions.status, 'reversed')))
    .limit(1);
  if (refs.length > 0) {
    throw new AppError(
      'conflict',
      'This project has non-reversed transactions referencing it. Reverse those first or archive the project instead.',
      { detail: { entity: 'project', id } },
    );
  }

  await db.delete(projects).where(eq(projects.id, id));

  await logAudit({
    actorId: ctx.userId,
    entityType: 'project',
    entityId: id,
    action: 'delete',
    changes: { hard_delete: true },
  });
  await logActivity({
    entityType: 'project',
    entityId: id,
    actorId: ctx.userId,
    kind: 'entity.hard_deleted',
    summary: 'Project hard-deleted',
  });
}

export async function hardDeleteProjects(ids: readonly string[]): Promise<{
  deleted: number;
  blocked: string[];
}> {
  const ctx = await getActorContext();
  if (ctx.role !== 'partner') {
    throw new AppError('forbidden', 'Hard delete of a project is restricted to the partner role.', {
      detail: { role: ctx.role },
    });
  }
  const parsed = ids.map((v) => ProjectIdSchema.parse(v));
  if (parsed.length === 0) return { deleted: 0, blocked: [] };

  const refs = await db
    .select({ id: transactions.projectId })
    .from(transactions)
    .where(
      and(inArray(transactions.projectId, parsed as string[]), ne(transactions.status, 'reversed')),
    );
  const blockedSet = new Set<string>();
  for (const r of refs) {
    if (r.id) blockedSet.add(r.id);
  }
  const deletable = parsed.filter((id) => !blockedSet.has(id));
  if (deletable.length === 0) {
    return { deleted: 0, blocked: Array.from(blockedSet) };
  }

  await db.delete(projects).where(inArray(projects.id, deletable as string[]));

  for (const id of deletable) {
    await logAudit({
      actorId: ctx.userId,
      entityType: 'project',
      entityId: id,
      action: 'delete',
      changes: { hard_delete: true },
    });
    await logActivity({
      entityType: 'project',
      entityId: id,
      actorId: ctx.userId,
      kind: 'entity.hard_deleted',
      summary: 'Project hard-deleted',
    });
  }
  return { deleted: deletable.length, blocked: Array.from(blockedSet) };
}

/* -------------------------------------------------------------------------- */
/* Create / Update / List                                                     */
/* -------------------------------------------------------------------------- */

/** DB enum values for project status. */
const ProjectStatusEnum = z.enum(['pitch', 'won', 'active', 'on_hold', 'completed', 'cancelled']);
export type ProjectStatus = z.infer<typeof ProjectStatusEnum>;

const CreateProjectSchema = z.object({
  clientId: z.string().uuid(),
  leadEmployeeId: z.string().uuid().nullable().optional(),
  accountManagerId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(200),
  code: z.string().max(60).nullable().optional(),
  status: ProjectStatusEnum.default('pitch'),
  feePaise: z.bigint().nonnegative().default(0n),
  startedOn: z.string().nullable().optional(),
  targetEndOn: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export async function createProject(input: CreateProjectInput): Promise<{ id: string }> {
  const ctx = await getActorContext();
  // Borrow update_client for project lifecycle (same as archive/restore here).
  requireCapability(ctx, 'update_client');
  const parsed = CreateProjectSchema.parse(input);

  const [row] = await db
    .insert(projects)
    .values({
      clientId: parsed.clientId,
      leadEmployeeId: parsed.leadEmployeeId ?? null,
      accountManagerId: parsed.accountManagerId ?? null,
      name: parsed.name,
      code: parsed.code ?? null,
      status: parsed.status,
      feePaise: parsed.feePaise,
      startedOn: parsed.startedOn ?? null,
      targetEndOn: parsed.targetEndOn ?? null,
      notes: parsed.notes ?? null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning({ id: projects.id });
  if (!row) throw new AppError('internal', 'projects insert returned no row');

  await logActivity({
    entityType: 'project',
    entityId: row.id,
    actorId: ctx.userId,
    kind: 'entity.created',
    summary: `Project created: ${parsed.name}`,
    payload: {
      project_id: row.id,
      client_id: parsed.clientId,
      lead_employee_id: parsed.leadEmployeeId ?? null,
      account_manager_id: parsed.accountManagerId ?? null,
      mentions: [
        { entityType: 'client', entityId: parsed.clientId },
        ...(parsed.leadEmployeeId
          ? [{ entityType: 'employee', entityId: parsed.leadEmployeeId }]
          : []),
      ],
    },
  });

  return { id: row.id };
}

const UpdateProjectSchema = z.object({
  clientId: z.string().uuid().optional(),
  leadEmployeeId: z.string().uuid().nullable().optional(),
  accountManagerId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(200).optional(),
  code: z.string().max(60).nullable().optional(),
  status: ProjectStatusEnum.optional(),
  feePaise: z.bigint().nonnegative().optional(),
  startedOn: z.string().nullable().optional(),
  targetEndOn: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;

export async function updateProject(id: string, patch: UpdateProjectInput): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_client');
  const parsed = UpdateProjectSchema.parse(patch);

  await db
    .update(projects)
    .set({
      ...(parsed.clientId !== undefined ? { clientId: parsed.clientId } : {}),
      ...(parsed.leadEmployeeId !== undefined ? { leadEmployeeId: parsed.leadEmployeeId } : {}),
      ...(parsed.accountManagerId !== undefined
        ? { accountManagerId: parsed.accountManagerId }
        : {}),
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.code !== undefined ? { code: parsed.code } : {}),
      ...(parsed.status !== undefined ? { status: parsed.status } : {}),
      ...(parsed.feePaise !== undefined ? { feePaise: parsed.feePaise } : {}),
      ...(parsed.startedOn !== undefined ? { startedOn: parsed.startedOn } : {}),
      ...(parsed.targetEndOn !== undefined ? { targetEndOn: parsed.targetEndOn } : {}),
      ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
      updatedBy: ctx.userId,
    })
    .where(and(eq(projects.id, id), isNull(projects.deletedAt)));

  await logAudit({
    actorId: ctx.userId,
    entityType: 'project',
    entityId: id,
    action: 'update',
    changes: parsed as Record<string, unknown>,
  });
}

/**
 * Full list for the OS Projects app. Joins clients + employees so the
 * matrix view can render display strings (client name, lead full name)
 * alongside the FK ids.
 */
export type ProjectListRow = {
  id: string;
  code: string | null;
  name: string;
  clientId: string;
  clientName: string;
  leadEmployeeId: string | null;
  leadName: string | null;
  status: ProjectStatus;
  feePaise: bigint;
  startedOn: string | null;
  targetEndOn: string | null;
  isArchived: boolean;
};

export async function listAllProjects(): Promise<readonly ProjectListRow[]> {
  await getActorContext();
  const rows = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      clientId: projects.clientId,
      clientName: clients.name,
      leadEmployeeId: projects.leadEmployeeId,
      leadName: sql<
        string | null
      >`(select full_name from employees where id = ${projects.leadEmployeeId})`,
      status: projects.status,
      feePaise: projects.feePaise,
      startedOn: projects.startedOn,
      targetEndOn: projects.targetEndOn,
      isArchived: projects.isArchived,
    })
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .where(isNull(projects.deletedAt))
    .orderBy(desc(projects.updatedAt))
    .limit(500);

  return rows.map(
    (r): ProjectListRow => ({
      id: r.id,
      code: r.code,
      name: r.name,
      clientId: r.clientId,
      clientName: r.clientName ?? '—',
      leadEmployeeId: r.leadEmployeeId,
      leadName: r.leadName,
      status: r.status,
      feePaise: r.feePaise,
      startedOn: r.startedOn,
      targetEndOn: r.targetEndOn,
      isArchived: r.isArchived,
    }),
  );
}

// dbStatusToCol / colToDbStatus / PROJECT_COLS / ProjectCol moved to
// `@/lib/project-status` — 'use server' modules can only export async
// functions, and the UI needs synchronous helpers for kanban rendering.

void employees; // keep import for future inner-join expansion
