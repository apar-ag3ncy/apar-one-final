'use server';

import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { serviceItems } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

/**
 * service_items CRUD. Capability `manage_service_items`.
 *
 * Captured-not-computed (CLAUDE rule #2): defaults set here are
 * suggestions for the invoice composer. The accountant overrides per
 * line; we never enforce rate × qty math from these fields.
 *
 * Soft-delete: `archiveServiceItem` sets `deletedAt` and `isActive=false`.
 * The picker filters `WHERE deleted_at IS NULL AND is_active = true`.
 * Historical invoice lines that snapshotted a now-archived item keep
 * their data — `invoice_lines.service_item_id` is `ON DELETE SET NULL`.
 */

const ServiceItemIdSchema = z.string().uuid();
const SacRe = /^[0-9]{4,8}$/; // CBIC: 4-8 digit SAC code

const ServiceItemInputSchema = z.object({
  sacCode: z
    .string()
    .trim()
    .refine((v) => SacRe.test(v), { message: 'SAC must be 4 to 8 digits.' }),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullish(),
  defaultRatePaise: z.bigint().nonnegative().nullish(),
  defaultUnit: z.string().trim().max(40).nullish(),
  /** GL code like "4100"; mirrors invoice_lines.posting_account_code shape. */
  defaultPostingAccountCode: z.string().trim().max(20).optional(),
  defaultGstRateBps: z.number().int().min(0).max(10000).optional(),
  defaultTdsSection: z.string().trim().max(20).nullish(),
});

export type ServiceItemInput = z.input<typeof ServiceItemInputSchema>;

export async function listServiceItems(opts?: {
  includeArchived?: boolean;
  includeInactive?: boolean;
}): Promise<Array<typeof serviceItems.$inferSelect>> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_service_items');

  const where = opts?.includeArchived
    ? undefined
    : opts?.includeInactive
      ? isNull(serviceItems.deletedAt)
      : and(isNull(serviceItems.deletedAt), eq(serviceItems.isActive, true));

  return db.select().from(serviceItems).where(where).orderBy(asc(serviceItems.name));
}

export async function getServiceItem(id: string): Promise<typeof serviceItems.$inferSelect | null> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_service_items');
  const parsed = ServiceItemIdSchema.parse(id);
  const [row] = await db.select().from(serviceItems).where(eq(serviceItems.id, parsed)).limit(1);
  return row ?? null;
}

export async function createServiceItem(input: ServiceItemInput): Promise<{ id: string }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_service_items');

  const v = ServiceItemInputSchema.parse(input);

  const [row] = await db
    .insert(serviceItems)
    .values({
      sacCode: v.sacCode,
      name: v.name,
      description: v.description ?? null,
      defaultRatePaise: v.defaultRatePaise ?? null,
      defaultUnit: v.defaultUnit ?? null,
      defaultPostingAccountCode: v.defaultPostingAccountCode ?? '4100',
      defaultGstRateBps: v.defaultGstRateBps ?? 1800,
      defaultTdsSection: v.defaultTdsSection ?? null,
      isActive: true,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning({ id: serviceItems.id });

  if (!row) {
    throw new AppError('internal', 'service_items insert returned no row');
  }
  return { id: row.id };
}

export async function updateServiceItem(
  id: string,
  input: Partial<ServiceItemInput> & { isActive?: boolean },
): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_service_items');
  const parsedId = ServiceItemIdSchema.parse(id);

  const patch: Partial<typeof serviceItems.$inferInsert> = {
    updatedBy: ctx.userId,
  };
  if (input.sacCode !== undefined) {
    if (!SacRe.test(input.sacCode)) throw new AppError('validation', 'SAC must be 4 to 8 digits.');
    patch.sacCode = input.sacCode;
  }
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description ?? null;
  if (input.defaultRatePaise !== undefined) patch.defaultRatePaise = input.defaultRatePaise ?? null;
  if (input.defaultUnit !== undefined) patch.defaultUnit = input.defaultUnit ?? null;
  if (input.defaultPostingAccountCode !== undefined)
    patch.defaultPostingAccountCode = input.defaultPostingAccountCode;
  if (input.defaultGstRateBps !== undefined) patch.defaultGstRateBps = input.defaultGstRateBps;
  if (input.defaultTdsSection !== undefined)
    patch.defaultTdsSection = input.defaultTdsSection ?? null;
  if (input.isActive !== undefined) patch.isActive = input.isActive;

  await db
    .update(serviceItems)
    .set(patch)
    .where(and(eq(serviceItems.id, parsedId), isNull(serviceItems.deletedAt)));
}

export async function archiveServiceItem(id: string): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_service_items');
  const parsed = ServiceItemIdSchema.parse(id);
  await db
    .update(serviceItems)
    .set({ deletedAt: new Date(), isActive: false, updatedBy: ctx.userId })
    .where(and(eq(serviceItems.id, parsed), isNull(serviceItems.deletedAt)));
}

export async function restoreServiceItem(id: string): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_service_items');
  const parsed = ServiceItemIdSchema.parse(id);
  await db
    .update(serviceItems)
    .set({ deletedAt: null, isActive: true, updatedBy: ctx.userId })
    .where(and(eq(serviceItems.id, parsed), isNotNull(serviceItems.deletedAt)));
}
