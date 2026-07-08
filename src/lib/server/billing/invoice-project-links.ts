'use server';

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import { invoiceLines, invoices, projects } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

/**
 * Project ↔ invoice linking (0062).
 *
 *   linkInvoiceToProject     — (re)set the HEADER project of an invoice in
 *     any state. Legal since 0062 removed project_id from the sent-invoice
 *     freeze: project linkage is management attribution, not part of the
 *     legal artifact.
 *   retagInvoiceLineProjects — fix per-line attributions post-send (lines
 *     have no freeze trigger; only project_id is touched).
 *   listInvoicesForProject   — everything linked to a project (header or
 *     line level), children included for parents, with conversion markers.
 *
 * Capability: create_invoice (same roles that manage billing).
 */

const UuidSchema = z.string().uuid();

export async function linkInvoiceToProject(
  invoiceId: string,
  projectId: string | null,
): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'create_invoice');
  const invId = UuidSchema.parse(invoiceId);
  const projId = projectId === null ? null : UuidSchema.parse(projectId);

  const [inv] = await db
    .select({ id: invoices.id, clientId: invoices.clientId, projectId: invoices.projectId })
    .from(invoices)
    .where(and(eq(invoices.id, invId), isNull(invoices.deletedAt)))
    .limit(1);
  if (!inv) throw new AppError('not_found', `invoice ${invId} not found`);

  if (projId) {
    const [p] = await db
      .select({ clientId: projects.clientId })
      .from(projects)
      .where(and(eq(projects.id, projId), isNull(projects.deletedAt)))
      .limit(1);
    if (!p) throw new AppError('validation', 'The selected project no longer exists.');
    if (p.clientId !== inv.clientId) {
      throw new AppError('validation', 'The selected project belongs to a different client.');
    }
  }

  await db
    .update(invoices)
    .set({ projectId: projId, updatedBy: ctx.userId })
    .where(eq(invoices.id, invId));

  await logAudit({
    actorId: ctx.userId,
    entityType: 'invoice',
    entityId: invId,
    action: 'update',
    changes: { project_id: { before: inv.projectId, after: projId } },
  });
}

const RetagSchema = z.array(z.object({ lineId: UuidSchema, projectId: UuidSchema.nullable() }));

/**
 * Post-send attribution fix: update ONLY project_id on the given lines.
 * Never routes through updateDraftInvoice's delete+reinsert (draft-only).
 */
export async function retagInvoiceLineProjects(
  invoiceId: string,
  retags: Array<{ lineId: string; projectId: string | null }>,
): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'create_invoice');
  const invId = UuidSchema.parse(invoiceId);
  const parsed = RetagSchema.parse(retags);
  if (parsed.length === 0) return;

  const [inv] = await db
    .select({ id: invoices.id, clientId: invoices.clientId })
    .from(invoices)
    .where(and(eq(invoices.id, invId), isNull(invoices.deletedAt)))
    .limit(1);
  if (!inv) throw new AppError('not_found', `invoice ${invId} not found`);

  const projIds = [...new Set(parsed.map((r) => r.projectId).filter((p): p is string => !!p))];
  if (projIds.length > 0) {
    const rows = await db
      .select({ id: projects.id, clientId: projects.clientId })
      .from(projects)
      .where(and(inArray(projects.id, projIds), isNull(projects.deletedAt)));
    const byId = new Map(rows.map((r) => [r.id, r.clientId]));
    for (const pid of projIds) {
      const owner = byId.get(pid);
      if (!owner) throw new AppError('validation', 'A selected project no longer exists.');
      if (owner !== inv.clientId) {
        throw new AppError('validation', 'A selected project belongs to a different client.');
      }
    }
  }

  await db.transaction(async (tx) => {
    for (const r of parsed) {
      await tx
        .update(invoiceLines)
        .set({ projectId: r.projectId, updatedBy: ctx.userId })
        .where(and(eq(invoiceLines.id, r.lineId), eq(invoiceLines.invoiceId, invId)));
    }
  });

  await logAudit({
    actorId: ctx.userId,
    entityType: 'invoice',
    entityId: invId,
    action: 'update',
    changes: { line_projects_retagged: parsed },
  });
}

export type ProjectInvoiceRow = {
  id: string;
  documentNumber: string;
  documentType: 'invoice' | 'proforma';
  documentDate: string;
  state: 'draft' | 'sent' | 'partially_paid' | 'paid' | 'void';
  capturedTotalPaise: bigint;
  coveredUnderRetainer: boolean;
  /** How this invoice links to the requested project. */
  linkedVia: 'header' | 'lines' | 'both';
  /** For sub-project rollups: which project in {P ∪ children(P)} it hit. */
  linkedProjectIds: readonly string[];
  /** Conversion trail (0062). */
  convertedFromInvoiceId: string | null;
  convertedFromNumber: string | null;
  convertedToNumber: string | null;
};

/**
 * Invoices linked to a project — header-level OR line-level — including the
 * project's live sub-projects (a parent rolls its children up). Excludes
 * soft-deleted rows; void invoices are INCLUDED (marked by state) so history
 * stays visible in the project window.
 */
export async function listInvoicesForProject(
  projectId: string,
): Promise<readonly ProjectInvoiceRow[]> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'create_invoice');
  const projId = UuidSchema.parse(projectId);

  const children = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.parentProjectId, projId), isNull(projects.deletedAt)));
  const family = [projId, ...children.map((c) => c.id)];
  // Parameterised `IN (...)` list, reused across the subqueries.
  const familyIn = sql.join(
    family.map((f) => sql`${f}`),
    sql`, `,
  );

  const rows = await db
    .select({
      id: invoices.id,
      documentNumber: invoices.documentNumber,
      documentType: invoices.documentType,
      documentDate: invoices.documentDate,
      state: invoices.state,
      capturedTotalPaise: invoices.capturedTotalPaise,
      coveredUnderRetainer: invoices.coveredUnderRetainer,
      headerProjectId: invoices.projectId,
      convertedFromInvoiceId: invoices.convertedFromInvoiceId,
      convertedFromNumber: sql<
        string | null
      >`(select document_number from invoices src where src.id = ${invoices.convertedFromInvoiceId})`,
      convertedToNumber: sql<
        string | null
      >`(select document_number from invoices conv where conv.converted_from_invoice_id = ${invoices.id} and conv.deleted_at is null limit 1)`,
      lineProjectIds: sql<string[] | null>`(
        select array_agg(distinct il.project_id) from invoice_lines il
        where il.invoice_id = ${invoices.id} and il.deleted_at is null
          and il.project_id in (${familyIn})
      )`,
    })
    .from(invoices)
    .where(
      and(
        isNull(invoices.deletedAt),
        sql`(
          ${invoices.projectId} in (${familyIn})
          or exists (
            select 1 from invoice_lines il
            where il.invoice_id = ${invoices.id} and il.deleted_at is null
              and il.project_id in (${familyIn})
          )
        )`,
      ),
    )
    .orderBy(asc(invoices.documentDate), asc(invoices.documentNumber));

  return rows.map((r): ProjectInvoiceRow => {
    const viaHeader = r.headerProjectId !== null && family.includes(r.headerProjectId);
    const lineIds = (r.lineProjectIds ?? []).filter((x): x is string => Boolean(x));
    const viaLines = lineIds.length > 0;
    const linked = new Set<string>(lineIds);
    if (viaHeader && r.headerProjectId) linked.add(r.headerProjectId);
    return {
      id: r.id,
      documentNumber: r.documentNumber,
      documentType: r.documentType,
      documentDate: r.documentDate,
      state: r.state,
      capturedTotalPaise: r.capturedTotalPaise,
      coveredUnderRetainer: r.coveredUnderRetainer,
      linkedVia: viaHeader && viaLines ? 'both' : viaHeader ? 'header' : 'lines',
      linkedProjectIds: [...linked],
      convertedFromInvoiceId: r.convertedFromInvoiceId,
      convertedFromNumber: r.convertedFromNumber,
      convertedToNumber: r.convertedToNumber,
    };
  });
}

/**
 * The client's invoices with NO project attribution at all (header nor any
 * line) — candidates for the project window's "Link existing…" picker.
 */
export async function listUnattributedInvoicesForClient(clientId: string): Promise<
  ReadonlyArray<{
    id: string;
    documentNumber: string;
    documentType: 'invoice' | 'proforma';
    documentDate: string;
    state: 'draft' | 'sent' | 'partially_paid' | 'paid' | 'void';
    capturedTotalPaise: bigint;
  }>
> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'create_invoice');
  const cid = UuidSchema.parse(clientId);

  return db
    .select({
      id: invoices.id,
      documentNumber: invoices.documentNumber,
      documentType: invoices.documentType,
      documentDate: invoices.documentDate,
      state: invoices.state,
      capturedTotalPaise: invoices.capturedTotalPaise,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.clientId, cid),
        isNull(invoices.deletedAt),
        isNull(invoices.projectId),
        sql`${invoices.state} <> 'void'`,
        sql`not exists (
          select 1 from invoice_lines il
          where il.invoice_id = ${invoices.id} and il.deleted_at is null
            and il.project_id is not null
        )`,
      ),
    )
    .orderBy(asc(invoices.documentDate), asc(invoices.documentNumber));
}
