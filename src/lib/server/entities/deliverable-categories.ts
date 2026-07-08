'use server';

import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import { deliverableCategories, projectTasks } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

/**
 * GLOBAL deliverable categories (0061) — user-defined buckets applying to
 * deliverables across ALL projects. Managed from the project window's
 * "Manage categories" modal.
 *
 * Capability stance mirrors project-tasks.ts: no dedicated capability exists,
 * so writes reuse `update_client` (authority over clients' projects implies
 * authority over the shared deliverable taxonomy). Reads only establish an
 * actor context.
 */

const CategoryIdSchema = z.string().uuid();

export type DeliverableCategoryRow = {
  id: string;
  name: string;
  color: string | null;
  position: number;
  /** Live deliverables currently pinned to this category (display only). */
  usageCount: number;
};

export async function listDeliverableCategories(): Promise<readonly DeliverableCategoryRow[]> {
  await getActorContext();
  const rows = await db
    .select({
      id: deliverableCategories.id,
      name: deliverableCategories.name,
      color: deliverableCategories.color,
      position: deliverableCategories.position,
      usageCount: sql<number>`(
        select count(*)::int from project_tasks t
        where t.category_id = ${deliverableCategories.id} and t.deleted_at is null
      )`,
    })
    .from(deliverableCategories)
    .where(isNull(deliverableCategories.deletedAt))
    .orderBy(asc(deliverableCategories.position), asc(deliverableCategories.name));

  return rows;
}

const CreateCategorySchema = z.object({
  name: z.string().min(1).max(80),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
});

export async function createDeliverableCategory(input: {
  name: string;
  color?: string | null;
}): Promise<DeliverableCategoryRow> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_client');
  const parsed = CreateCategorySchema.parse(input);
  const name = parsed.name.trim();
  if (!name) throw new AppError('validation', 'Category name is required.');

  // Friendly duplicate check ahead of the partial unique index.
  const [dup] = await db
    .select({ id: deliverableCategories.id })
    .from(deliverableCategories)
    .where(
      and(
        sql`lower(${deliverableCategories.name}) = lower(${name})`,
        isNull(deliverableCategories.deletedAt),
      ),
    )
    .limit(1);
  if (dup) {
    throw new AppError('conflict', `A category named "${name}" already exists.`, {
      detail: { name },
    });
  }

  const [row] = await db
    .insert(deliverableCategories)
    .values({
      name,
      color: parsed.color ?? null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning({
      id: deliverableCategories.id,
      name: deliverableCategories.name,
      color: deliverableCategories.color,
      position: deliverableCategories.position,
    });
  if (!row) throw new AppError('internal', 'deliverable_categories insert returned no row');

  await logAudit({
    actorId: ctx.userId,
    entityType: 'settings',
    entityId: row.id,
    action: 'insert',
    changes: { deliverable_category_created: { id: row.id, name } },
  });

  return { ...row, usageCount: 0 };
}

const UpdateCategorySchema = z.object({
  id: CategoryIdSchema,
  name: z.string().min(1).max(80).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  position: z.number().int().min(0).optional(),
});

export async function updateDeliverableCategory(input: {
  id: string;
  name?: string;
  color?: string | null;
  position?: number;
}): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_client');
  const parsed = UpdateCategorySchema.parse(input);

  await db
    .update(deliverableCategories)
    .set({
      ...(parsed.name !== undefined ? { name: parsed.name.trim() } : {}),
      ...(parsed.color !== undefined ? { color: parsed.color } : {}),
      ...(parsed.position !== undefined ? { position: parsed.position } : {}),
      updatedBy: ctx.userId,
    })
    .where(and(eq(deliverableCategories.id, parsed.id), isNull(deliverableCategories.deletedAt)));

  const { id: _id, ...changes } = parsed;
  await logAudit({
    actorId: ctx.userId,
    entityType: 'settings',
    entityId: parsed.id,
    action: 'update',
    changes: { deliverable_category_updated: { id: parsed.id, ...changes } },
  });
}

/**
 * Soft-delete a category. Deliverables pointing at it keep working — the FK
 * is SET NULL only on hard delete, and reads left-join, so rows just lose
 * their chip. The picker stops offering it.
 */
export async function archiveDeliverableCategory(id: string): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_client');
  const parsed = CategoryIdSchema.parse(id);

  // Detach live deliverables so a later same-name category starts clean.
  await db
    .update(projectTasks)
    .set({ categoryId: null, updatedBy: ctx.userId })
    .where(and(eq(projectTasks.categoryId, parsed), isNull(projectTasks.deletedAt)));

  await db
    .update(deliverableCategories)
    .set({ deletedAt: new Date(), updatedBy: ctx.userId })
    .where(and(eq(deliverableCategories.id, parsed), isNull(deliverableCategories.deletedAt)));

  await logAudit({
    actorId: ctx.userId,
    entityType: 'settings',
    entityId: parsed,
    action: 'delete',
    changes: { deliverable_category_archived: { id: parsed } },
  });
}
