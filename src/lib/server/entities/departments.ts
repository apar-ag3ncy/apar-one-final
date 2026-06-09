'use server';

import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import { departments } from '@/lib/db/schema/departments';
import { employees } from '@/lib/db/schema/employees';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { normalizeDepartmentName } from '@/lib/server/entities/department-registry';

/**
 * Department registry CRUD for the Employees module's "Manage departments" UI.
 * Gated on `update_employee` (whoever can edit employees can curate the
 * department taxonomy). Names are stored canonical-lowercased; the UI renders
 * them title-cased. Renames bulk-update `employees.department` so the link
 * never drifts; deletes are blocked while employees still reference the name.
 */

const NameSchema = z
  .string()
  .trim()
  .min(1, 'Department name is required.')
  .max(120, 'Department name is too long.');

export type DepartmentRow = {
  id: string;
  name: string;
  label: string;
  employeeCount: number;
};

export type DepartmentMutationResult =
  | { ok: true }
  | { ok: false; message: string; errors?: Record<string, string> };

function titleCase(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Map of department name → count of current (non-deleted) employees. */
async function employeeCountsByDept(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      name: sql<string>`lower(trim(${employees.department}))`,
      count: sql<number>`count(*)::int`,
    })
    .from(employees)
    .where(
      and(
        isNull(employees.deletedAt),
        sql`${employees.department} is not null and trim(${employees.department}) <> ''`,
      ),
    )
    .groupBy(sql`lower(trim(${employees.department}))`);
  return new Map(rows.map((r) => [r.name, r.count]));
}

/** All managed departments with their current employee counts. */
export async function listDepartmentsDetailed(): Promise<readonly DepartmentRow[]> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_employee');

  const [rows, counts] = await Promise.all([
    db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(isNull(departments.deletedAt))
      .orderBy(departments.name),
    employeeCountsByDept(),
  ]);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    label: titleCase(r.name),
    employeeCount: counts.get(r.name) ?? 0,
  }));
}

/** Create (or revive a previously-deleted) department. */
export async function createDepartment(name: string): Promise<DepartmentMutationResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_employee');

  const parsed = NameSchema.safeParse(name);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid name.',
      errors: { name: parsed.error.issues[0]?.message ?? 'Invalid name.' },
    };
  }
  const n = normalizeDepartmentName(parsed.data);

  const existing = await db
    .select({ id: departments.id, deletedAt: departments.deletedAt })
    .from(departments)
    .where(eq(departments.name, n))
    .limit(1);

  if (existing[0]) {
    if (existing[0].deletedAt === null) {
      return {
        ok: false,
        message: `A department named "${titleCase(n)}" already exists.`,
        errors: { name: 'Already exists.' },
      };
    }
    // Revive a soft-deleted department.
    await db
      .update(departments)
      .set({ deletedAt: null, updatedBy: ctx.userId, updatedAt: new Date() })
      .where(eq(departments.id, existing[0].id));
    await logAudit({
      actorId: ctx.userId,
      entityType: 'departments',
      entityId: existing[0].id,
      action: 'update',
      changes: { revived: { name: n } },
    });
    return { ok: true };
  }

  const [row] = await db
    .insert(departments)
    .values({ name: n, createdBy: ctx.userId, updatedBy: ctx.userId })
    .returning({ id: departments.id });
  if (row) {
    await logAudit({
      actorId: ctx.userId,
      entityType: 'departments',
      entityId: row.id,
      action: 'insert',
      changes: { name: { after: n } },
    });
  }
  return { ok: true };
}

/** Rename a department and bulk-update every employee that referenced it. */
export async function renameDepartment(
  id: string,
  name: string,
): Promise<DepartmentMutationResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_employee');

  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) return { ok: false, message: 'Unknown department.' };
  const parsed = NameSchema.safeParse(name);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid name.',
      errors: { name: parsed.error.issues[0]?.message ?? 'Invalid name.' },
    };
  }
  const next = normalizeDepartmentName(parsed.data);

  const current = await db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(and(eq(departments.id, parsedId.data), isNull(departments.deletedAt)))
    .limit(1);
  if (!current[0]) return { ok: false, message: 'Department not found.' };
  const prev = current[0].name;
  if (prev === next) return { ok: true };

  // Refuse a rename that collides with another live department.
  const dup = await db
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        eq(departments.name, next),
        ne(departments.id, parsedId.data),
        isNull(departments.deletedAt),
      ),
    )
    .limit(1);
  if (dup[0]) {
    return {
      ok: false,
      message: `A department named "${titleCase(next)}" already exists.`,
      errors: { name: 'Already exists.' },
    };
  }

  let affected = 0;
  await db.transaction(async (tx) => {
    await tx
      .update(departments)
      .set({ name: next, updatedBy: ctx.userId, updatedAt: new Date() })
      .where(eq(departments.id, parsedId.data));
    const updated = await tx
      .update(employees)
      .set({ department: next })
      .where(sql`lower(trim(${employees.department})) = ${prev}`)
      .returning({ id: employees.id });
    affected = updated.length;
  });

  await logAudit({
    actorId: ctx.userId,
    entityType: 'departments',
    entityId: parsedId.data,
    action: 'update',
    changes: { name: { before: prev, after: next }, employeesReassigned: affected },
  });
  return { ok: true };
}

/** Soft-delete a department. Blocked while current employees still reference it. */
export async function deleteDepartment(id: string): Promise<DepartmentMutationResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_employee');

  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) return { ok: false, message: 'Unknown department.' };

  const current = await db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(and(eq(departments.id, parsedId.data), isNull(departments.deletedAt)))
    .limit(1);
  if (!current[0]) return { ok: false, message: 'Department not found.' };

  const counts = await employeeCountsByDept();
  const inUse = counts.get(current[0].name) ?? 0;
  if (inUse > 0) {
    return {
      ok: false,
      message: `${inUse} ${inUse === 1 ? 'person is' : 'people are'} in this department — move them to another department first.`,
    };
  }

  await db
    .update(departments)
    .set({ deletedAt: new Date(), updatedBy: ctx.userId })
    .where(eq(departments.id, parsedId.data));
  await logAudit({
    actorId: ctx.userId,
    entityType: 'departments',
    entityId: parsedId.data,
    action: 'delete',
    changes: { name: { before: current[0].name } },
  });
  return { ok: true };
}
