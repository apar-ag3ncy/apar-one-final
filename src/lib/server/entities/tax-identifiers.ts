'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { logActivity } from '@/lib/activity';
import { db, type DbClient } from '@/lib/db/client';
import { entityTaxIdentifiers } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability, type Capability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

export type TaxIdentifierEntityType = 'client' | 'vendor' | 'employee' | 'project' | 'office';
export type TaxIdentifierKindDb = 'pan' | 'gstin' | 'tan' | 'msme_udyam' | 'lut' | 'aadhaar';

const entityTypeSchema = z.enum(['client', 'vendor', 'employee', 'project', 'office']);
const kindSchema = z.enum(['pan', 'gstin', 'tan', 'msme_udyam', 'lut', 'aadhaar']);

/**
 * Vault discipline:
 *   - GSTIN is public; `maskedValue` carries the full GSTIN, `vaultObjectKey`
 *     may be null.
 *   - Everything else: `maskedValue` shows the safe mask ('XXXXXX1234X'),
 *     `vaultObjectKey` points at the encrypted blob in `restricted-kyc`.
 *   - Aadhaar additionally requires `entity_type='employee'` AND
 *     `vault_object_key IS NOT NULL` (CHECK enforced at the DB layer).
 */
const TaxIdInputSchema = z
  .object({
    entityType: entityTypeSchema,
    entityId: z.string().uuid(),
    kind: kindSchema,
    maskedValue: z.string().min(1).max(40),
    vaultObjectKey: z.string().min(1).max(500).optional().nullable(),
    issuedOn: z.string().max(20).optional().nullable(),
    expiresOn: z.string().max(20).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .refine((v) => v.kind !== 'aadhaar' || (v.entityType === 'employee' && !!v.vaultObjectKey), {
    message: 'Aadhaar is employee-only and must include a vault object key.',
    path: ['vaultObjectKey'],
  });

const TaxIdPatchSchema = z.object({
  maskedValue: z.string().min(1).max(40).optional(),
  vaultObjectKey: z.string().min(1).max(500).optional().nullable(),
  issuedOn: z.string().max(20).optional().nullable(),
  expiresOn: z.string().max(20).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export type TaxIdentifierInput = z.infer<typeof TaxIdInputSchema>;
export type TaxIdentifierPatch = z.infer<typeof TaxIdPatchSchema>;

export type TaxIdentifierRow = {
  id: string;
  kind: TaxIdentifierKindDb;
  maskedValue: string;
  vaultObjectKey: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  notes: string | null;
};

function rowToTaxId(r: typeof entityTaxIdentifiers.$inferSelect): TaxIdentifierRow {
  return {
    id: r.id,
    kind: r.kind,
    maskedValue: r.maskedValue,
    vaultObjectKey: r.vaultObjectKey,
    issuedOn: r.issuedOn,
    expiresOn: r.expiresOn,
    notes: r.notes,
  };
}

function updateCapabilityFor(entityType: TaxIdentifierEntityType): Capability {
  switch (entityType) {
    case 'client':
      return 'update_client';
    case 'vendor':
      return 'update_vendor';
    case 'employee':
      return 'update_employee';
    case 'project':
    case 'office':
      return 'update_client';
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listTaxIdentifiers(args: {
  entityType: TaxIdentifierEntityType;
  entityId: string;
  includeArchived?: boolean;
}): Promise<readonly TaxIdentifierRow[]> {
  await getActorContext();
  const rows = await db
    .select()
    .from(entityTaxIdentifiers)
    .where(
      and(
        eq(entityTaxIdentifiers.entityType, args.entityType),
        eq(entityTaxIdentifiers.entityId, args.entityId),
        args.includeArchived ? undefined : isNull(entityTaxIdentifiers.deletedAt),
      ),
    )
    .orderBy(entityTaxIdentifiers.kind);
  return rows.map(rowToTaxId);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createTaxIdentifier(input: TaxIdentifierInput): Promise<TaxIdentifierRow> {
  const ctx = await getActorContext();
  const parsed = TaxIdInputSchema.parse(input);
  requireCapability(ctx, updateCapabilityFor(parsed.entityType));

  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(entityTaxIdentifiers)
      .values({
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        kind: parsed.kind,
        maskedValue: parsed.maskedValue,
        vaultObjectKey: parsed.vaultObjectKey ?? null,
        issuedOn: parsed.issuedOn ?? null,
        expiresOn: parsed.expiresOn ?? null,
        notes: parsed.notes ?? null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    if (!row) throw new AppError('internal', 'entity_tax_identifiers insert returned no row');

    await logActivity(
      {
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        actorId: ctx.userId,
        kind: 'tax_id.added',
        summary: `Added ${parsed.kind.toUpperCase()} identifier`,
        payload: { taxIdentifierId: row.id, kind: parsed.kind },
      },
      tx as unknown as DbClient,
    );
    return rowToTaxId(row);
  });
}

export async function updateTaxIdentifier(
  id: string,
  patch: TaxIdentifierPatch,
): Promise<TaxIdentifierRow> {
  const ctx = await getActorContext();
  const parsed = TaxIdPatchSchema.parse(patch);

  const existingRows = await db
    .select()
    .from(entityTaxIdentifiers)
    .where(and(eq(entityTaxIdentifiers.id, id), isNull(entityTaxIdentifiers.deletedAt)))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) throw new AppError('not_found', `Tax identifier ${id} not found`);
  requireCapability(ctx, updateCapabilityFor(existing.entityType));

  // Aadhaar invariant: never let an update strip the vault pointer.
  if (existing.kind === 'aadhaar' && parsed.vaultObjectKey === null) {
    throw new AppError(
      'validation',
      'Aadhaar requires a vault object key — cannot clear vault_object_key.',
    );
  }

  const [row] = await db
    .update(entityTaxIdentifiers)
    .set({
      maskedValue: parsed.maskedValue ?? existing.maskedValue,
      vaultObjectKey:
        parsed.vaultObjectKey === undefined ? existing.vaultObjectKey : parsed.vaultObjectKey,
      issuedOn: parsed.issuedOn === undefined ? existing.issuedOn : parsed.issuedOn,
      expiresOn: parsed.expiresOn === undefined ? existing.expiresOn : parsed.expiresOn,
      notes: parsed.notes === undefined ? existing.notes : parsed.notes,
      updatedBy: ctx.userId,
    })
    .where(eq(entityTaxIdentifiers.id, id))
    .returning();
  if (!row) throw new AppError('internal', 'entity_tax_identifiers update returned no row');
  return rowToTaxId(row);
}

export async function softDeleteTaxIdentifier(id: string): Promise<void> {
  const ctx = await getActorContext();
  const existingRows = await db
    .select()
    .from(entityTaxIdentifiers)
    .where(and(eq(entityTaxIdentifiers.id, id), isNull(entityTaxIdentifiers.deletedAt)))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) throw new AppError('not_found', `Tax identifier ${id} not found`);

  const isPartnerOrAdmin = ctx.role === 'partner' || ctx.role === 'admin';
  const isCreator = existing.createdBy === ctx.userId;
  if (!isPartnerOrAdmin && !isCreator) {
    requireCapability(ctx, updateCapabilityFor(existing.entityType));
  }

  await db
    .update(entityTaxIdentifiers)
    .set({ deletedAt: new Date(), updatedBy: ctx.userId })
    .where(eq(entityTaxIdentifiers.id, id));

  await logActivity({
    entityType: existing.entityType,
    entityId: existing.entityId,
    actorId: ctx.userId,
    kind: 'tax_id.removed',
    summary: `Removed ${existing.kind.toUpperCase()} identifier`,
    payload: { taxIdentifierId: id, kind: existing.kind },
  });
}

export async function restoreTaxIdentifier(id: string): Promise<TaxIdentifierRow> {
  const ctx = await getActorContext();
  const existingRows = await db
    .select()
    .from(entityTaxIdentifiers)
    .where(eq(entityTaxIdentifiers.id, id))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) throw new AppError('not_found', `Tax identifier ${id} not found`);
  if (!existing.deletedAt) return rowToTaxId(existing);

  const isPartnerOrAdmin = ctx.role === 'partner' || ctx.role === 'admin';
  const isCreator = existing.createdBy === ctx.userId;
  if (!isPartnerOrAdmin && !isCreator) {
    requireCapability(ctx, updateCapabilityFor(existing.entityType));
  }

  const [row] = await db
    .update(entityTaxIdentifiers)
    .set({ deletedAt: null, updatedBy: ctx.userId })
    .where(eq(entityTaxIdentifiers.id, id))
    .returning();
  if (!row) throw new AppError('internal', 'entity_tax_identifiers restore returned no row');
  return rowToTaxId(row);
}

export async function hardDeleteTaxIdentifier(id: string): Promise<void> {
  const ctx = await getActorContext();
  if (ctx.role !== 'partner') {
    throw new AppError(
      'forbidden',
      'Hard delete of a tax identifier is restricted to the partner role.',
      { detail: { role: ctx.role } },
    );
  }
  await db.delete(entityTaxIdentifiers).where(eq(entityTaxIdentifiers.id, id));
}
