'use server';

import { desc, eq, inArray, isNotNull, or } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  bonusesAndPerks,
  clients,
  documents,
  employees,
  entityActivityLog,
  entityDocuments,
  officeExpenseCategories,
  officeExpenses,
  projects,
  salaryPayments,
  salaryStructures,
  users,
  vendors,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { getActorContext } from '@/lib/server/actor';
import { restoreClient, hardDeleteClient } from '@/lib/server/entities/clients';
import { restoreDocument, permanentlyDeleteDocument } from '@/lib/server/entities/entity-documents';
import { restoreEmployee, hardDeleteEmployee } from '@/lib/server/entities/employees';
import {
  restoreOfficeExpense,
  permanentlyDeleteOfficeExpense,
  restoreOfficeExpenseCategory,
  permanentlyDeleteOfficeExpenseCategory,
} from '@/lib/server/entities/office-expenses';
import {
  restoreSalaryPayment,
  permanentlyDeleteSalaryPayment,
  restoreSalaryStructure,
  permanentlyDeleteSalaryStructure,
  restoreBonusOrPerk,
  permanentlyDeleteBonusOrPerk,
} from '@/lib/server/entities/payroll';
import { restoreProject, hardDeleteProject } from '@/lib/server/entities/projects';
import { restoreVendor, hardDeleteVendor } from '@/lib/server/entities/vendors';

/**
 * Trash / Archive control surface for admins + partners (SPEC-AMENDMENT-001
 * §2 lifecycle). Aggregates every soft-deleted or archived row across the
 * principal directories (clients / vendors / employees / projects), the
 * Office app (expenses + custom categories), and document links, then
 * dispatches restore / permanent-delete back to each entity's own gated
 * action.
 *
 * Reads only require an actor context — the OS Trash view is admin-facing
 * but the individual restore/purge actions self-check (`requireCapability`
 * / partner-only role guards inside the underlying functions), so the
 * aggregate list itself doesn't add a second gate. The write dispatchers
 * additionally refuse anyone who isn't admin/partner up front so a
 * lower-privileged actor never reaches the per-kind hard-delete paths.
 *
 * Soft-delete columns by table (confirmed against the schema):
 *   - clients / vendors / employees / projects → `is_archived` (+ `archived_at`)
 *     is the entity-level archive flag; `deleted_at` is the polymorphic
 *     timestamp mixin (rarely set at the entity level but honoured here so a
 *     genuinely trashed principal still surfaces). reason='archived' when
 *     `is_archived`, else 'trashed'.
 *   - office_expenses / office_expense_categories → `deleted_at` (soft delete).
 *   - entity_documents → `status='soft_deleted'` (the file + documents row stay).
 */

const TRASH_KINDS = [
  'client',
  'vendor',
  'employee',
  'project',
  'office_expense',
  'office_expense_category',
  'salary_payment',
  'salary_structure',
  'bonus',
  'document',
] as const;

export type TrashKind = (typeof TRASH_KINDS)[number];

export type TrashItemRow = {
  kind: TrashKind;
  id: string;
  label: string;
  sublabel: string | null;
  deletedAt: string | null;
  reason: 'archived' | 'trashed';
};

export type TrashLogRow = {
  id: string;
  at: string;
  actorName: string | null;
  summary: string;
};

const LIST_CAP = 500;

/** Days an item stays in the Trash before it is disposed of automatically. */
const TRASH_RETENTION_DAYS = 30;

/** Normalise a timestamp column (Date | string | null) to an ISO string. */
function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Aggregate every archived / trashed row into a single list. Each source
 * table is queried with a narrow select (id + a name column + the relevant
 * timestamps) and merged in JS — cheaper and clearer than a SQL UNION across
 * six heterogeneous tables. Ordered newest-first by whichever timestamp
 * applies (archived_at → deleted_at → updated_at fallback), capped at 500.
 */
export async function listTrash(): Promise<readonly TrashItemRow[]> {
  await getActorContext();

  const items: TrashItemRow[] = [];
  const pushItem = (row: TrashItemRow): void => {
    items.push(row);
  };

  // -- Clients (name column) ------------------------------------------------
  {
    const rows = await db
      .select({
        id: clients.id,
        label: clients.name,
        isArchived: clients.isArchived,
        archivedAt: clients.archivedAt,
        deletedAt: clients.deletedAt,
      })
      .from(clients)
      .where(or(eq(clients.isArchived, true), isNotNull(clients.deletedAt)))
      .limit(LIST_CAP);
    for (const r of rows) {
      const archived = Boolean(r.isArchived) && r.deletedAt == null;
      pushItem({
        kind: 'client',
        id: r.id,
        label: r.label ?? '—',
        sublabel: null,
        deletedAt: toIso(r.deletedAt) ?? toIso(r.archivedAt),
        reason: archived ? 'archived' : 'trashed',
      });
    }
  }

  // -- Vendors (name column) ------------------------------------------------
  {
    const rows = await db
      .select({
        id: vendors.id,
        label: vendors.name,
        isArchived: vendors.isArchived,
        archivedAt: vendors.archivedAt,
        deletedAt: vendors.deletedAt,
      })
      .from(vendors)
      .where(or(eq(vendors.isArchived, true), isNotNull(vendors.deletedAt)))
      .limit(LIST_CAP);
    for (const r of rows) {
      const archived = Boolean(r.isArchived) && r.deletedAt == null;
      pushItem({
        kind: 'vendor',
        id: r.id,
        label: r.label ?? '—',
        sublabel: null,
        deletedAt: toIso(r.deletedAt) ?? toIso(r.archivedAt),
        reason: archived ? 'archived' : 'trashed',
      });
    }
  }

  // -- Projects (name column) -----------------------------------------------
  {
    const rows = await db
      .select({
        id: projects.id,
        label: projects.name,
        isArchived: projects.isArchived,
        archivedAt: projects.archivedAt,
        deletedAt: projects.deletedAt,
      })
      .from(projects)
      .where(or(eq(projects.isArchived, true), isNotNull(projects.deletedAt)))
      .limit(LIST_CAP);
    for (const r of rows) {
      const archived = Boolean(r.isArchived) && r.deletedAt == null;
      pushItem({
        kind: 'project',
        id: r.id,
        label: r.label ?? '—',
        sublabel: null,
        deletedAt: toIso(r.deletedAt) ?? toIso(r.archivedAt),
        reason: archived ? 'archived' : 'trashed',
      });
    }
  }

  // -- Employees (fullName column) ------------------------------------------
  {
    const rows = await db
      .select({
        id: employees.id,
        label: employees.fullName,
        code: employees.employeeCode,
        isArchived: employees.isArchived,
        archivedAt: employees.archivedAt,
        deletedAt: employees.deletedAt,
      })
      .from(employees)
      .where(or(eq(employees.isArchived, true), isNotNull(employees.deletedAt)))
      .limit(LIST_CAP);
    for (const r of rows) {
      const archived = Boolean(r.isArchived) && r.deletedAt == null;
      pushItem({
        kind: 'employee',
        id: r.id,
        label: r.label ?? '—',
        sublabel: r.code ?? null,
        deletedAt: toIso(r.deletedAt) ?? toIso(r.archivedAt),
        reason: archived ? 'archived' : 'trashed',
      });
    }
  }

  // -- Office expenses (description column) — soft-delete only --------------
  {
    const rows = await db
      .select({
        id: officeExpenses.id,
        label: officeExpenses.description,
        expenseDate: officeExpenses.expenseDate,
        deletedAt: officeExpenses.deletedAt,
      })
      .from(officeExpenses)
      .where(isNotNull(officeExpenses.deletedAt))
      .limit(LIST_CAP);
    for (const r of rows) {
      pushItem({
        kind: 'office_expense',
        id: r.id,
        label: r.label ?? '—',
        sublabel: r.expenseDate ?? null,
        deletedAt: toIso(r.deletedAt),
        reason: 'trashed',
      });
    }
  }

  // -- Office expense categories (name column) — soft-delete only ----------
  {
    const rows = await db
      .select({
        id: officeExpenseCategories.id,
        label: officeExpenseCategories.name,
        deletedAt: officeExpenseCategories.deletedAt,
      })
      .from(officeExpenseCategories)
      .where(isNotNull(officeExpenseCategories.deletedAt))
      .limit(LIST_CAP);
    for (const r of rows) {
      pushItem({
        kind: 'office_expense_category',
        id: r.id,
        label: r.label ?? '—',
        sublabel: 'Custom category',
        deletedAt: toIso(r.deletedAt),
        reason: 'trashed',
      });
    }
  }

  // -- Salary payments (soft-delete; ledger effect reversed on delete) ------
  {
    const rows = await db
      .select({
        id: salaryPayments.id,
        amountPaise: salaryPayments.amountPaise,
        paidOn: salaryPayments.paidOn,
        employeeName: employees.fullName,
        deletedAt: salaryPayments.deletedAt,
      })
      .from(salaryPayments)
      .innerJoin(employees, eq(employees.id, salaryPayments.employeeId))
      .where(isNotNull(salaryPayments.deletedAt))
      .limit(LIST_CAP);
    for (const r of rows) {
      pushItem({
        kind: 'salary_payment',
        id: r.id,
        label: `₹${(Number(r.amountPaise) / 100).toLocaleString('en-IN')} — ${r.employeeName}`,
        sublabel: `paid ${r.paidOn}`,
        deletedAt: toIso(r.deletedAt),
        reason: 'trashed',
      });
    }
  }

  // -- Salary updates (structure versions; soft-delete) ---------------------
  {
    const rows = await db
      .select({
        id: salaryStructures.id,
        ctcMonthlyPaise: salaryStructures.ctcMonthlyPaise,
        effectiveFrom: salaryStructures.effectiveFrom,
        employeeName: employees.fullName,
        deletedAt: salaryStructures.deletedAt,
      })
      .from(salaryStructures)
      .innerJoin(employees, eq(employees.id, salaryStructures.employeeId))
      .where(isNotNull(salaryStructures.deletedAt))
      .limit(LIST_CAP);
    for (const r of rows) {
      pushItem({
        kind: 'salary_structure',
        id: r.id,
        label: `CTC ₹${(Number(r.ctcMonthlyPaise) / 100).toLocaleString('en-IN')}/mo — ${r.employeeName}`,
        sublabel: `effective ${r.effectiveFrom}`,
        deletedAt: toIso(r.deletedAt),
        reason: 'trashed',
      });
    }
  }

  // -- Bonuses & perks (soft-delete) ----------------------------------------
  {
    const rows = await db
      .select({
        id: bonusesAndPerks.id,
        description: bonusesAndPerks.description,
        amountPaise: bonusesAndPerks.amountPaise,
        bonusDate: bonusesAndPerks.bonusDate,
        employeeName: employees.fullName,
        deletedAt: bonusesAndPerks.deletedAt,
      })
      .from(bonusesAndPerks)
      .innerJoin(employees, eq(employees.id, bonusesAndPerks.employeeId))
      .where(isNotNull(bonusesAndPerks.deletedAt))
      .limit(LIST_CAP);
    for (const r of rows) {
      const amt =
        r.amountPaise == null
          ? 'in-kind'
          : `₹${(Number(r.amountPaise) / 100).toLocaleString('en-IN')}`;
      pushItem({
        kind: 'bonus',
        id: r.id,
        label: `${r.description} (${amt}) — ${r.employeeName}`,
        sublabel: r.bonusDate,
        deletedAt: toIso(r.deletedAt),
        reason: 'trashed',
      });
    }
  }

  // -- Documents (status='soft_deleted') — label = filename/title ----------
  {
    const rows = await db
      .select({
        id: entityDocuments.id,
        title: entityDocuments.title,
        filename: documents.originalFilename,
        kind: entityDocuments.kind,
        updatedAt: entityDocuments.updatedAt,
      })
      .from(entityDocuments)
      .innerJoin(documents, eq(documents.id, entityDocuments.documentId))
      .where(eq(entityDocuments.status, 'soft_deleted'))
      .orderBy(desc(entityDocuments.updatedAt))
      .limit(LIST_CAP);
    for (const r of rows) {
      pushItem({
        kind: 'document',
        id: r.id,
        label: r.title || r.filename || '—',
        // entity_documents has no deleted_at column — the soft-delete lives in
        // `status`. Use updatedAt (set when the status flipped) as the trash
        // timestamp so the row sorts alongside the rest.
        sublabel: r.kind ? r.kind.replace(/_/g, ' ') : null,
        deletedAt: toIso(r.updatedAt),
        reason: 'trashed',
      });
    }
  }

  // 30-day retention: anything that has sat in the Trash longer than
  // TRASH_RETENTION_DAYS is disposed of automatically the next time the
  // Trash is opened. Best-effort per item — an entity still referenced by
  // non-reversed ledger transactions refuses hard deletion and simply stays
  // listed. Each successful purge leaves only its entity.hard_deleted log
  // line (written by the kind-specific hard delete).
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 86_400_000;
  const purged = new Set<string>();
  for (const item of items) {
    if (!item.deletedAt || Date.parse(item.deletedAt) >= cutoff) continue;
    try {
      await permanentlyDeleteTrashItem({ kind: item.kind, id: item.id });
      purged.add(`${item.kind}:${item.id}`);
    } catch {
      // Still referenced (or caller lacks the delete role) — keep it listed.
    }
  }
  const live = items.filter((i) => !purged.has(`${i.kind}:${i.id}`));

  // Newest-first by the trash/archive timestamp; rows without one sort last.
  const at = (r: TrashItemRow): number => (r.deletedAt ? Date.parse(r.deletedAt) : 0);
  live.sort((a, b) => at(b) - at(a));
  return live.slice(0, LIST_CAP);
}

/**
 * Restore an archived / trashed row. Dispatches to the entity's own restore
 * action, each of which re-checks its capability and re-logs the event. For
 * documents the id is the `entity_documents` row id.
 */
export async function restoreTrashItem(input: { kind: TrashKind; id: string }): Promise<void> {
  await getActorContext();
  const { kind, id } = input;
  switch (kind) {
    case 'client':
      await restoreClient(id);
      return;
    case 'vendor':
      await restoreVendor(id);
      return;
    case 'employee':
      await restoreEmployee(id);
      return;
    case 'project':
      await restoreProject(id);
      return;
    case 'office_expense':
      await restoreOfficeExpense({ id });
      return;
    case 'office_expense_category':
      await restoreOfficeExpenseCategory({ id });
      return;
    case 'salary_payment':
      await restoreSalaryPayment({ id });
      return;
    case 'salary_structure':
      await restoreSalaryStructure({ id });
      return;
    case 'bonus':
      await restoreBonusOrPerk({ id });
      return;
    case 'document':
      await restoreDocument(id);
      return;
    default:
      throw new AppError('validation', `Unknown trash kind "${kind as string}".`);
  }
}

/**
 * Permanently purge a trashed / archived row. Gated to admin + partner up
 * front; each underlying hard-delete additionally self-checks (the principal
 * hard-deletes are partner-only and refuse when non-reversed transactions
 * still reference the row). Every underlying action logs its own
 * `entity.hard_deleted` / `document.deleted` event, so this dispatcher does
 * not double-log.
 */
export async function permanentlyDeleteTrashItem(input: {
  kind: TrashKind;
  id: string;
}): Promise<void> {
  const ctx = await getActorContext();
  if (ctx.role !== 'partner' && ctx.role !== 'admin') {
    throw new AppError('forbidden', 'Permanent delete is restricted to admins and partners.', {
      detail: { role: ctx.role },
    });
  }

  const { kind, id } = input;
  switch (kind) {
    case 'client':
      await hardDeleteClient(id);
      return;
    case 'vendor':
      await hardDeleteVendor(id);
      return;
    case 'employee':
      await hardDeleteEmployee(id);
      return;
    case 'project':
      await hardDeleteProject(id);
      return;
    case 'office_expense':
      await permanentlyDeleteOfficeExpense({ id });
      return;
    case 'office_expense_category':
      await permanentlyDeleteOfficeExpenseCategory({ id });
      return;
    case 'salary_payment':
      await permanentlyDeleteSalaryPayment({ id });
      return;
    case 'salary_structure':
      await permanentlyDeleteSalaryStructure({ id });
      return;
    case 'bonus':
      await permanentlyDeleteBonusOrPerk({ id });
      return;
    case 'document':
      // permanentlyDeleteDocument returns { fileRemoved } — the trash surface
      // doesn't need it, so we discard.
      await permanentlyDeleteDocument(id);
      return;
    default:
      throw new AppError('validation', `Unknown trash kind "${kind as string}".`);
  }
}

/**
 * Recent deletion / archive / restore events from the typed activity stream.
 * Backs the "Trash log" panel. Filtered to the lifecycle kinds that touch
 * trash, joined to the actor's display name, newest-first, capped at 100.
 */
export async function listTrashLog(): Promise<readonly TrashLogRow[]> {
  await getActorContext();

  const rows = await db
    .select({
      id: entityActivityLog.id,
      at: entityActivityLog.createdAt,
      actorName: users.fullName,
      summary: entityActivityLog.summary,
    })
    .from(entityActivityLog)
    .leftJoin(users, eq(users.id, entityActivityLog.actorId))
    .where(
      inArray(entityActivityLog.kind, [
        'entity.archived',
        'entity.restored',
        'entity.hard_deleted',
        'document.deleted',
        'salary_payment.deleted',
        'salary_payment.restored',
        'salary_structure.deleted',
        'salary_structure.restored',
        'bonus.deleted',
        'bonus.restored',
      ]),
    )
    .orderBy(desc(entityActivityLog.createdAt))
    .limit(100);

  return rows.map(
    (r): TrashLogRow => ({
      id: r.id,
      at: toIso(r.at) ?? '',
      actorName: r.actorName ?? null,
      summary: r.summary,
    }),
  );
}

// Note: the contract's optional `logActivity('entity.hard_deleted')` fallback
// is unnecessary here — every principal hard-delete (clients/vendors/employees/
// projects) already logs 'entity.hard_deleted', and the document +
// office-expense purges log 'document.deleted' / audit rows respectively, so no
// dispatch path leaves a purge un-recorded.
