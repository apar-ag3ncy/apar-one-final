'use server';

import { and, asc, eq, isNull } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { clients, employees, projects, vendors } from '@/lib/db/schema';
import { getActorContext } from '@/lib/server/actor';

/**
 * Lightweight `{ id, label }` option lists for dropdowns. These replace the
 * `SAMPLE_*` fixtures the ledger / payroll / billing forms imported, and back
 * the wizards' relation pickers (e.g. employee "Reports to"). Kept separate
 * from the rich list mappers in `server-stub/entity-actions.ts` so a select
 * doesn't pay for joins it doesn't need.
 */

export type EntityOption = { id: string; label: string; sub?: string | null };

export async function listClientOptions(): Promise<readonly EntityOption[]> {
  await getActorContext();
  const rows = await db
    .select({ id: clients.id, name: clients.name, industry: clients.industry })
    .from(clients)
    .where(and(isNull(clients.deletedAt), eq(clients.isArchived, false)))
    .orderBy(asc(clients.name));
  return rows.map((r) => ({ id: r.id, label: r.name, sub: r.industry }));
}

export async function listVendorOptions(): Promise<readonly EntityOption[]> {
  await getActorContext();
  const rows = await db
    .select({ id: vendors.id, name: vendors.name, category: vendors.category })
    .from(vendors)
    .where(and(isNull(vendors.deletedAt), eq(vendors.isArchived, false)))
    .orderBy(asc(vendors.name));
  return rows.map((r) => ({ id: r.id, label: r.name, sub: r.category }));
}

export async function listEmployeeOptions(): Promise<readonly EntityOption[]> {
  await getActorContext();
  const rows = await db
    .select({
      id: employees.id,
      fullName: employees.fullName,
      designation: employees.designation,
    })
    .from(employees)
    .where(and(isNull(employees.deletedAt), eq(employees.isArchived, false)))
    .orderBy(asc(employees.fullName));
  return rows.map((r) => ({ id: r.id, label: r.fullName, sub: r.designation }));
}

export async function listProjectOptions(): Promise<readonly EntityOption[]> {
  await getActorContext();
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      code: projects.code,
    })
    .from(projects)
    .where(and(isNull(projects.deletedAt), eq(projects.isArchived, false)))
    .orderBy(asc(projects.name));
  return rows.map((r) => ({ id: r.id, label: r.name, sub: r.code }));
}

/**
 * Active (non-archived) projects for a single client — backs the project
 * picker on the invoice composer and the "expenses on behalf" form, where the
 * choices must be scoped to the client the document is for.
 *
 * Sub-projects (0061) are listed under their parent and labelled
 * "Parent › Sub" so a per-line picker reads unambiguously.
 */
export async function listProjectOptionsForClient(
  clientId: string,
): Promise<readonly EntityOption[]> {
  await getActorContext();
  if (!clientId) return [];
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      code: projects.code,
      parentProjectId: projects.parentProjectId,
    })
    .from(projects)
    .where(
      and(
        eq(projects.clientId, clientId),
        isNull(projects.deletedAt),
        eq(projects.isArchived, false),
      ),
    )
    .orderBy(asc(projects.name));

  const byId = new Map(rows.map((r) => [r.id, r]));
  const parents = rows.filter((r) => !r.parentProjectId);
  const childrenOf = (pid: string) => rows.filter((r) => r.parentProjectId === pid);
  const out: EntityOption[] = [];
  for (const p of parents) {
    out.push({ id: p.id, label: p.name, sub: p.code });
    for (const c of childrenOf(p.id)) {
      out.push({ id: c.id, label: `${p.name} › ${c.name}`, sub: c.code });
    }
  }
  // Orphaned subs (parent archived/deleted) still need to be pickable.
  for (const r of rows) {
    if (r.parentProjectId && !byId.has(r.parentProjectId)) {
      out.push({ id: r.id, label: `› ${r.name}`, sub: r.code });
    }
  }
  return out;
}
