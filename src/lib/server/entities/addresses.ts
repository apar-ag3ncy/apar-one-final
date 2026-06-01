'use server';

import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { logActivity } from '@/lib/activity';
import { db, type DbClient } from '@/lib/db/client';
import { entityAddresses } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability, type Capability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

export type AddressEntityType = 'client' | 'vendor' | 'employee' | 'project' | 'office';
export type AddressKindDb = 'billing' | 'shipping' | 'registered' | 'site' | 'home';

const entityTypeSchema = z.enum(['client', 'vendor', 'employee', 'project', 'office']);
const kindSchema = z.enum(['billing', 'shipping', 'registered', 'site', 'home']);

const AddressInputSchema = z.object({
  entityType: entityTypeSchema,
  entityId: z.string().uuid(),
  kind: kindSchema,
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional().nullable(),
  city: z.string().min(1).max(120),
  stateCode: z
    .string()
    .min(2)
    .max(2)
    .regex(/^[A-Z]{2}$/),
  postalCode: z.string().max(20).optional().nullable(),
  country: z.string().min(2).max(2).default('IN'),
  gstin: z.string().max(20).optional().nullable(),
  isPrimary: z.boolean().default(false),
  notes: z.string().max(2000).optional().nullable(),
});

const AddressPatchSchema = z.object({
  kind: kindSchema.optional(),
  line1: z.string().min(1).max(200).optional(),
  line2: z.string().max(200).optional().nullable(),
  city: z.string().min(1).max(120).optional(),
  stateCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  postalCode: z.string().max(20).optional().nullable(),
  country: z.string().min(2).max(2).optional(),
  gstin: z.string().max(20).optional().nullable(),
  isPrimary: z.boolean().optional(),
  notes: z.string().max(2000).optional().nullable(),
});

export type AddressInput = z.infer<typeof AddressInputSchema>;
export type AddressPatch = z.infer<typeof AddressPatchSchema>;

export type AddressRow = {
  id: string;
  kind: AddressKindDb;
  line1: string;
  line2: string | null;
  city: string;
  stateCode: string;
  postalCode: string | null;
  country: string;
  gstin: string | null;
  isPrimary: boolean;
  notes: string | null;
};

function rowToAddress(r: typeof entityAddresses.$inferSelect): AddressRow {
  return {
    id: r.id,
    kind: r.kind,
    line1: r.line1,
    line2: r.line2,
    city: r.city,
    stateCode: r.stateCode,
    postalCode: r.postalCode,
    country: r.country,
    gstin: r.gstin,
    isPrimary: r.isPrimary,
    notes: r.notes,
  };
}

function updateCapabilityFor(entityType: AddressEntityType): Capability {
  switch (entityType) {
    case 'client':
      return 'update_client';
    case 'vendor':
      return 'update_vendor';
    case 'employee':
      return 'update_employee';
    case 'project':
    case 'office':
      return 'update_client'; // partner/admin pass through; managers use client-level cap
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listAddresses(args: {
  entityType: AddressEntityType;
  entityId: string;
  includeArchived?: boolean;
}): Promise<readonly AddressRow[]> {
  await getActorContext();
  const rows = await db
    .select()
    .from(entityAddresses)
    .where(
      and(
        eq(entityAddresses.entityType, args.entityType),
        eq(entityAddresses.entityId, args.entityId),
        args.includeArchived ? undefined : isNull(entityAddresses.deletedAt),
      ),
    )
    .orderBy(desc(entityAddresses.isPrimary), entityAddresses.kind);
  return rows.map(rowToAddress);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createAddress(input: AddressInput): Promise<AddressRow> {
  const ctx = await getActorContext();
  const parsed = AddressInputSchema.parse(input);
  requireCapability(ctx, updateCapabilityFor(parsed.entityType));

  return await db.transaction(async (tx) => {
    if (parsed.isPrimary) {
      // Demote existing primary addresses of the same kind for this entity.
      await tx
        .update(entityAddresses)
        .set({ isPrimary: false, updatedBy: ctx.userId })
        .where(
          and(
            eq(entityAddresses.entityType, parsed.entityType),
            eq(entityAddresses.entityId, parsed.entityId),
            eq(entityAddresses.isPrimary, true),
            isNull(entityAddresses.deletedAt),
          ),
        );
    }
    const [row] = await tx
      .insert(entityAddresses)
      .values({
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        kind: parsed.kind,
        line1: parsed.line1,
        line2: parsed.line2 ?? null,
        city: parsed.city,
        stateCode: parsed.stateCode,
        postalCode: parsed.postalCode ?? null,
        country: parsed.country,
        gstin: parsed.gstin ?? null,
        isPrimary: parsed.isPrimary,
        notes: parsed.notes ?? null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    if (!row) throw new AppError('internal', 'entity_addresses insert returned no row');

    await logActivity(
      {
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        actorId: ctx.userId,
        kind: 'address.added',
        summary: `Added ${parsed.kind} address`,
        payload: { addressId: row.id, kind: parsed.kind },
      },
      tx as unknown as DbClient,
    );
    return rowToAddress(row);
  });
}

export async function updateAddress(id: string, patch: AddressPatch): Promise<AddressRow> {
  const ctx = await getActorContext();
  const parsed = AddressPatchSchema.parse(patch);

  const existingRows = await db
    .select()
    .from(entityAddresses)
    .where(and(eq(entityAddresses.id, id), isNull(entityAddresses.deletedAt)))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) throw new AppError('not_found', `Address ${id} not found`);
  requireCapability(ctx, updateCapabilityFor(existing.entityType));

  return await db.transaction(async (tx) => {
    if (parsed.isPrimary === true) {
      await tx
        .update(entityAddresses)
        .set({ isPrimary: false, updatedBy: ctx.userId })
        .where(
          and(
            eq(entityAddresses.entityType, existing.entityType),
            eq(entityAddresses.entityId, existing.entityId),
            eq(entityAddresses.isPrimary, true),
            isNull(entityAddresses.deletedAt),
          ),
        );
    }
    const [row] = await tx
      .update(entityAddresses)
      .set({
        kind: parsed.kind ?? existing.kind,
        line1: parsed.line1 ?? existing.line1,
        line2: parsed.line2 === undefined ? existing.line2 : parsed.line2,
        city: parsed.city ?? existing.city,
        stateCode: parsed.stateCode ?? existing.stateCode,
        postalCode: parsed.postalCode === undefined ? existing.postalCode : parsed.postalCode,
        country: parsed.country ?? existing.country,
        gstin: parsed.gstin === undefined ? existing.gstin : parsed.gstin,
        isPrimary: parsed.isPrimary ?? existing.isPrimary,
        notes: parsed.notes === undefined ? existing.notes : parsed.notes,
        updatedBy: ctx.userId,
      })
      .where(eq(entityAddresses.id, id))
      .returning();
    if (!row) throw new AppError('internal', 'entity_addresses update returned no row');
    return rowToAddress(row);
  });
}

export async function softDeleteAddress(id: string): Promise<void> {
  const ctx = await getActorContext();
  const existingRows = await db
    .select()
    .from(entityAddresses)
    .where(and(eq(entityAddresses.id, id), isNull(entityAddresses.deletedAt)))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) throw new AppError('not_found', `Address ${id} not found`);

  const isPartnerOrAdmin = ctx.role === 'partner' || ctx.role === 'admin';
  const isCreator = existing.createdBy === ctx.userId;
  if (!isPartnerOrAdmin && !isCreator) {
    requireCapability(ctx, updateCapabilityFor(existing.entityType));
  }

  await db
    .update(entityAddresses)
    .set({ deletedAt: new Date(), updatedBy: ctx.userId })
    .where(eq(entityAddresses.id, id));

  await logActivity({
    entityType: existing.entityType,
    entityId: existing.entityId,
    actorId: ctx.userId,
    kind: 'address.removed',
    summary: `Removed ${existing.kind} address`,
    payload: { addressId: id, kind: existing.kind },
  });
}

export async function restoreAddress(id: string): Promise<AddressRow> {
  const ctx = await getActorContext();
  const existingRows = await db
    .select()
    .from(entityAddresses)
    .where(eq(entityAddresses.id, id))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) throw new AppError('not_found', `Address ${id} not found`);
  if (!existing.deletedAt) return rowToAddress(existing);

  const isPartnerOrAdmin = ctx.role === 'partner' || ctx.role === 'admin';
  const isCreator = existing.createdBy === ctx.userId;
  if (!isPartnerOrAdmin && !isCreator) {
    requireCapability(ctx, updateCapabilityFor(existing.entityType));
  }

  const [row] = await db
    .update(entityAddresses)
    .set({ deletedAt: null, updatedBy: ctx.userId })
    .where(eq(entityAddresses.id, id))
    .returning();
  if (!row) throw new AppError('internal', 'entity_addresses restore returned no row');
  return rowToAddress(row);
}

export async function hardDeleteAddress(id: string): Promise<void> {
  const ctx = await getActorContext();
  if (ctx.role !== 'partner') {
    throw new AppError(
      'forbidden',
      'Hard delete of an address is restricted to the partner role.',
      { detail: { role: ctx.role } },
    );
  }
  await db.delete(entityAddresses).where(eq(entityAddresses.id, id));
}
