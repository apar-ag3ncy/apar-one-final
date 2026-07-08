'use server';

import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logActivity } from '@/lib/activity';
import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import {
  clients,
  employees,
  entityContacts,
  invoiceLines,
  invoices,
  projects,
  transactions,
} from '@/lib/db/schema';
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

  // New RESTRICT FKs (0061/0062) — check dependents up front so the user
  // gets a friendly message instead of a raw FK error.
  const [childRef] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.parentProjectId, id))
    .limit(1);
  if (childRef) {
    throw new AppError(
      'conflict',
      'This project has sub-projects. Delete or re-home the sub-projects first.',
      { detail: { entity: 'project', id } },
    );
  }
  const [invoiceRef] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.projectId, id))
    .limit(1);
  const [lineRef] = invoiceRef
    ? [invoiceRef]
    : await db
        .select({ id: invoiceLines.id })
        .from(invoiceLines)
        .where(eq(invoiceLines.projectId, id))
        .limit(1);
  if (invoiceRef || lineRef) {
    throw new AppError(
      'conflict',
      'This project is linked to invoices. Unlink or delete those invoices first, or archive the project instead.',
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
  // RESTRICT dependents from 0061/0062: sub-projects and invoice links.
  // A parent whose children are in the same batch still blocks — delete the
  // children first, then the parent (Trash surfaces the blocked count).
  const childRefs = await db
    .select({ id: projects.parentProjectId })
    .from(projects)
    .where(inArray(projects.parentProjectId, parsed as string[]));
  for (const r of childRefs) {
    if (r.id) blockedSet.add(r.id);
  }
  const invoiceRefs = await db
    .select({ id: invoices.projectId })
    .from(invoices)
    .where(inArray(invoices.projectId, parsed as string[]));
  for (const r of invoiceRefs) {
    if (r.id) blockedSet.add(r.id);
  }
  const lineRefs = await db
    .select({ id: invoiceLines.projectId })
    .from(invoiceLines)
    .where(inArray(invoiceLines.projectId, parsed as string[]));
  for (const r of lineRefs) {
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
  /** Client-side POC — one of the client's entity_contacts rows (0061). */
  clientContactId: z.string().uuid().nullable().optional(),
  /** Parent project when creating a sub-project (one level deep, 0061). */
  parentProjectId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(200),
  code: z.string().max(60).nullable().optional(),
  status: ProjectStatusEnum.default('pitch'),
  feePaise: z.bigint().nonnegative().default(0n),
  startedOn: z.string().nullable().optional(),
  targetEndOn: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

/**
 * Generate the next 'PRJ-NNNN' project code by scanning the auto series
 * (0063). Best-effort; `projects_auto_code_unique` (partial, auto pattern
 * only) is the real guard. User-typed free-form codes are untouched.
 */
async function nextProjectCode(): Promise<string> {
  const rows = await db
    .select({ code: projects.code })
    .from(projects)
    .where(sql`${projects.code} ~ '^PRJ-[0-9]+$'`);
  let max = 0;
  for (const r of rows) {
    const m = /^PRJ-(\d+)$/.exec(r.code ?? '');
    if (m) max = Math.max(max, Number.parseInt(m[1]!, 10));
  }
  return `PRJ-${String(max + 1).padStart(4, '0')}`;
}

/**
 * Assert the given entity_contacts row is a contact OF this client.
 * Throws AppError('validation', …) otherwise.
 */
async function assertClientContact(contactId: string, clientId: string): Promise<void> {
  const [row] = await db
    .select({ id: entityContacts.id })
    .from(entityContacts)
    .where(
      and(
        eq(entityContacts.id, contactId),
        eq(entityContacts.entityType, 'client'),
        eq(entityContacts.entityId, clientId),
        isNull(entityContacts.deletedAt),
      ),
    )
    .limit(1);
  if (!row) {
    throw new AppError('validation', 'The chosen POC is not a contact of this client.', {
      detail: { contactId, clientId },
    });
  }
}

export async function createProject(input: CreateProjectInput): Promise<{ id: string }> {
  const ctx = await getActorContext();
  // Borrow update_client for project lifecycle (same as archive/restore here).
  requireCapability(ctx, 'update_client');
  const parsed = CreateProjectSchema.parse(input);

  // Sub-project rules (tg_projects_one_level_nesting backstops at the DB):
  // the parent must exist and be top-level; the sub INHERITS the parent's
  // client regardless of what the caller sent.
  let clientId = parsed.clientId;
  if (parsed.parentProjectId) {
    const [parent] = await db
      .select({
        id: projects.id,
        clientId: projects.clientId,
        parentProjectId: projects.parentProjectId,
      })
      .from(projects)
      .where(and(eq(projects.id, parsed.parentProjectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!parent) {
      throw new AppError('not_found', 'Parent project not found.', {
        detail: { parentProjectId: parsed.parentProjectId },
      });
    }
    if (parent.parentProjectId) {
      throw new AppError(
        'validation',
        'Sub-projects nest one level deep — the parent is itself a sub-project.',
        { detail: { parentProjectId: parsed.parentProjectId } },
      );
    }
    clientId = parent.clientId;
  }

  if (parsed.clientContactId) {
    await assertClientContact(parsed.clientContactId, clientId);
  }

  const code = parsed.code?.trim() ? parsed.code.trim() : await nextProjectCode();

  const [row] = await db
    .insert(projects)
    .values({
      clientId,
      leadEmployeeId: parsed.leadEmployeeId ?? null,
      accountManagerId: parsed.accountManagerId ?? null,
      clientContactId: parsed.clientContactId ?? null,
      parentProjectId: parsed.parentProjectId ?? null,
      name: parsed.name,
      code,
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
      client_id: clientId,
      lead_employee_id: parsed.leadEmployeeId ?? null,
      account_manager_id: parsed.accountManagerId ?? null,
      parent_project_id: parsed.parentProjectId ?? null,
      mentions: [
        { entityType: 'client', entityId: clientId },
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
  clientContactId: z.string().uuid().nullable().optional(),
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

  if (parsed.clientContactId) {
    // Validate against the project's EFFECTIVE client (the patched one when
    // the client is changing in the same call).
    let clientId = parsed.clientId;
    if (!clientId) {
      const [current] = await db
        .select({ clientId: projects.clientId })
        .from(projects)
        .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
        .limit(1);
      clientId = current?.clientId;
    }
    if (clientId) await assertClientContact(parsed.clientContactId, clientId);
  }

  await db
    .update(projects)
    .set({
      ...(parsed.clientId !== undefined ? { clientId: parsed.clientId } : {}),
      ...(parsed.leadEmployeeId !== undefined ? { leadEmployeeId: parsed.leadEmployeeId } : {}),
      ...(parsed.accountManagerId !== undefined
        ? { accountManagerId: parsed.accountManagerId }
        : {}),
      ...(parsed.clientContactId !== undefined ? { clientContactId: parsed.clientContactId } : {}),
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
  /** True when the linked client is archived or soft-deleted. UI uses this
   * to append an "(ex-client)" suffix so the rendered project list still
   * works even after the client is gone from the active directory. */
  clientArchived: boolean;
  leadEmployeeId: string | null;
  leadName: string | null;
  accountManagerId: string | null;
  /** Internal POC — the account manager's display name. */
  accountManagerName: string | null;
  clientContactId: string | null;
  /** Client-side POC — the entity_contacts row's name. */
  clientContactName: string | null;
  /** Parent when this row is a sub-project (one level deep). */
  parentProjectId: string | null;
  /** Live (non-archived, non-deleted) sub-projects under this row. */
  subProjectCount: number;
  /** Σ feePaise over live sub-projects — display-only, never stored. */
  subFeeSumPaise: bigint;
  /**
   * Invoices linked to THIS row (header or line level), excluding void and
   * soft-deleted. Parents aggregate children client-side (all rows are in
   * the same list payload).
   */
  linkedInvoiceCount: number;
  status: ProjectStatus;
  feePaise: bigint;
  startedOn: string | null;
  targetEndOn: string | null;
  isArchived: boolean;
};

/** Shared select for listAllProjects / listSubProjects. */
function projectListSelect() {
  return {
    id: projects.id,
    code: projects.code,
    name: projects.name,
    clientId: projects.clientId,
    clientName: clients.name,
    clientIsArchived: clients.isArchived,
    clientDeletedAt: clients.deletedAt,
    leadEmployeeId: projects.leadEmployeeId,
    leadName: sql<
      string | null
    >`(select full_name from employees where id = ${projects.leadEmployeeId})`,
    accountManagerId: projects.accountManagerId,
    accountManagerName: sql<
      string | null
    >`(select full_name from users where id = ${projects.accountManagerId})`,
    clientContactId: projects.clientContactId,
    clientContactName: sql<
      string | null
    >`(select name from entity_contacts where id = ${projects.clientContactId})`,
    parentProjectId: projects.parentProjectId,
    subProjectCount: sql<number>`(
      select count(*)::int from projects c
      where c.parent_project_id = ${projects.id}
        and c.deleted_at is null and c.is_archived = false
    )`,
    subFeeSumPaise: sql<string>`(
      select coalesce(sum(c.fee_paise), 0)::text from projects c
      where c.parent_project_id = ${projects.id}
        and c.deleted_at is null and c.is_archived = false
    )`,
    linkedInvoiceCount: sql<number>`(
      select count(*)::int from invoices i
      where i.deleted_at is null and i.state <> 'void'
        and (
          i.project_id = ${projects.id}
          or exists (
            select 1 from invoice_lines il
            where il.invoice_id = i.id and il.deleted_at is null
              and il.project_id = ${projects.id}
          )
        )
    )`,
    status: projects.status,
    feePaise: projects.feePaise,
    startedOn: projects.startedOn,
    targetEndOn: projects.targetEndOn,
    isArchived: projects.isArchived,
  };
}

type ProjectListDbRow = {
  id: string;
  code: string | null;
  name: string;
  clientId: string;
  clientName: string | null;
  clientIsArchived: boolean | null;
  clientDeletedAt: Date | null;
  leadEmployeeId: string | null;
  leadName: string | null;
  accountManagerId: string | null;
  accountManagerName: string | null;
  clientContactId: string | null;
  clientContactName: string | null;
  parentProjectId: string | null;
  subProjectCount: number;
  subFeeSumPaise: string;
  linkedInvoiceCount: number;
  status: ProjectStatus;
  feePaise: bigint;
  startedOn: string | null;
  targetEndOn: string | null;
  isArchived: boolean;
};

function mapProjectListRow(r: ProjectListDbRow): ProjectListRow {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    clientId: r.clientId,
    clientName: r.clientName ?? '—',
    clientArchived: Boolean(r.clientIsArchived) || r.clientDeletedAt !== null,
    leadEmployeeId: r.leadEmployeeId,
    leadName: r.leadName,
    accountManagerId: r.accountManagerId,
    accountManagerName: r.accountManagerName,
    clientContactId: r.clientContactId,
    clientContactName: r.clientContactName,
    parentProjectId: r.parentProjectId,
    subProjectCount: r.subProjectCount,
    subFeeSumPaise: BigInt(r.subFeeSumPaise ?? '0'),
    linkedInvoiceCount: r.linkedInvoiceCount,
    status: r.status,
    feePaise: r.feePaise,
    startedOn: r.startedOn,
    targetEndOn: r.targetEndOn,
    isArchived: r.isArchived,
  };
}

export async function listAllProjects(): Promise<readonly ProjectListRow[]> {
  await getActorContext();
  const rows = await db
    .select(projectListSelect())
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .where(isNull(projects.deletedAt))
    .orderBy(desc(projects.updatedAt))
    .limit(500);

  return rows.map(mapProjectListRow);
}

/** Live sub-projects of one parent, oldest first. */
export async function listSubProjects(parentId: string): Promise<readonly ProjectListRow[]> {
  await getActorContext();
  const id = ProjectIdSchema.parse(parentId);
  const rows = await db
    .select(projectListSelect())
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(projects.parentProjectId, id), isNull(projects.deletedAt)))
    .orderBy(projects.createdAt);

  return rows.map(mapProjectListRow);
}

// dbStatusToCol / colToDbStatus / PROJECT_COLS / ProjectCol moved to
// `@/lib/project-status` — 'use server' modules can only export async
// functions, and the UI needs synchronous helpers for kanban rendering.

void employees; // keep import for future inner-join expansion
