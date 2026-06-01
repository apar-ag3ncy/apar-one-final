'use server';

import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { logActivity } from '@/lib/activity';
import { db, type DbClient } from '@/lib/db/client';
import { entityCustomValues, formFields } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability, type Capability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

/**
 * Custom-value writes — one row per (entity, form_field). The unique
 * (entity_type, entity_id, form_field_id) index in
 * `drizzle/0003_entity_subgraph.sql:493` makes create/update idempotent: an
 * upsert collapses to a single row.
 *
 * AUDIT-GAPS §2.2 invariants: the row's JSONB `value` shape must match the
 * field's `type`. We validate here at the application layer (the trigger in
 * 0006 also enforces this at the DB layer, defense-in-depth).
 */

export type CustomValueEntityType = 'client' | 'vendor' | 'employee' | 'project' | 'office';

const entityTypeSchema = z.enum(['client', 'vendor', 'employee', 'project', 'office']);

const CustomValueInputSchema = z.object({
  entityType: entityTypeSchema,
  entityId: z.string().uuid(),
  formFieldId: z.string().uuid(),
  value: z.unknown(), // shape validated against field.type below
});

const CustomValuePatchSchema = z.object({
  value: z.unknown(),
});

export type CustomValueInput = z.infer<typeof CustomValueInputSchema>;
export type CustomValuePatch = z.infer<typeof CustomValuePatchSchema>;

export type CustomValueRow = {
  id: string;
  entityType: CustomValueEntityType;
  entityId: string;
  formFieldId: string;
  value: unknown;
};

function rowToValue(r: typeof entityCustomValues.$inferSelect): CustomValueRow {
  return {
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    formFieldId: r.formFieldId,
    value: r.value,
  };
}

function updateCapabilityFor(entityType: CustomValueEntityType): Capability {
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

/**
 * Validate the JSONB value against the field's declared type. Mirrors
 * AUDIT-GAPS §2.2 + the DB trigger. Throws AppError('validation') on
 * mismatch — the calling form layer should surface this near the field.
 */
function validateValueForType(value: unknown, type: typeof formFields.$inferSelect.type): void {
  if (value === null || value === undefined) return; // null clears the value
  switch (type) {
    case 'text':
    case 'longtext':
    case 'gstin':
    case 'pan':
    case 'phone':
    case 'email':
    case 'url':
      if (typeof value !== 'string') {
        throw new AppError('validation', `Expected string for field type "${type}".`);
      }
      return;
    case 'number':
    case 'currency':
      if (typeof value !== 'number' && typeof value !== 'string') {
        throw new AppError('validation', `Expected number for field type "${type}".`);
      }
      return;
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw new AppError('validation', `Expected boolean for field type "${type}".`);
      }
      return;
    case 'date':
    case 'datetime':
      if (typeof value !== 'string') {
        throw new AppError('validation', `Expected ISO date string for field type "${type}".`);
      }
      return;
    case 'select':
      if (typeof value !== 'string') {
        throw new AppError('validation', `Expected string for select field.`);
      }
      return;
    case 'multiselect':
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
        throw new AppError('validation', `Expected array of strings for multiselect field.`);
      }
      return;
    case 'file':
      // { document_id, signed?: boolean }
      if (
        typeof value !== 'object' ||
        value === null ||
        !('document_id' in value) ||
        typeof (value as Record<string, unknown>).document_id !== 'string'
      ) {
        throw new AppError('validation', `File field requires { document_id: string }.`);
      }
      return;
    case 'address':
      if (typeof value !== 'object' || value === null) {
        throw new AppError('validation', `Address field requires an object.`);
      }
      return;
    case 'relation':
      if (typeof value !== 'string') {
        throw new AppError('validation', `Relation field requires entity uuid string.`);
      }
      return;
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listCustomValues(args: {
  entityType: CustomValueEntityType;
  entityId: string;
}): Promise<readonly CustomValueRow[]> {
  await getActorContext();
  const rows = await db
    .select()
    .from(entityCustomValues)
    .where(
      and(
        eq(entityCustomValues.entityType, args.entityType),
        eq(entityCustomValues.entityId, args.entityId),
        isNull(entityCustomValues.deletedAt),
      ),
    )
    .orderBy(desc(entityCustomValues.updatedAt));
  return rows.map(rowToValue);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

async function fieldOrThrow(formFieldId: string) {
  // Reject soft-deleted fields: a field can be deprecated between when a
  // wizard loads its template and when it submits, and values must not be
  // written against a logically-deleted field (AUDIT-GAPS §2.2 — soft-delete
  // preserves existing data but stops new writes).
  const rows = await db
    .select()
    .from(formFields)
    .where(and(eq(formFields.id, formFieldId), isNull(formFields.deletedAt)))
    .limit(1);
  const field = rows[0];
  if (!field) throw new AppError('not_found', `Form field ${formFieldId} not found`);
  return field;
}

/**
 * Upsert a custom value. The composite unique index makes
 * `INSERT ... ON CONFLICT DO UPDATE` natural; expressed in two writes here
 * because Drizzle's onConflict path for composite indexes is awkward and the
 * read-then-write inside a transaction is just as safe.
 */
export async function createCustomValue(input: CustomValueInput): Promise<CustomValueRow> {
  const ctx = await getActorContext();
  const parsed = CustomValueInputSchema.parse(input);
  requireCapability(ctx, updateCapabilityFor(parsed.entityType));

  const field = await fieldOrThrow(parsed.formFieldId);
  validateValueForType(parsed.value, field.type);

  return await db.transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(entityCustomValues)
      .where(
        and(
          eq(entityCustomValues.entityType, parsed.entityType),
          eq(entityCustomValues.entityId, parsed.entityId),
          eq(entityCustomValues.formFieldId, parsed.formFieldId),
          isNull(entityCustomValues.deletedAt),
        ),
      )
      .limit(1);

    if (existingRows[0]) {
      const [row] = await tx
        .update(entityCustomValues)
        .set({ value: parsed.value as never, updatedBy: ctx.userId })
        .where(eq(entityCustomValues.id, existingRows[0].id))
        .returning();
      if (!row) throw new AppError('internal', 'entity_custom_values update returned no row');
      return rowToValue(row);
    }

    const [row] = await tx
      .insert(entityCustomValues)
      .values({
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        formFieldId: parsed.formFieldId,
        value: parsed.value as never,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    if (!row) throw new AppError('internal', 'entity_custom_values insert returned no row');

    await logActivity(
      {
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        actorId: ctx.userId,
        kind: 'form_field.value_changed',
        summary: `Set ${field.label}`,
        payload: { formFieldId: parsed.formFieldId, formFieldKey: field.key },
      },
      tx as unknown as DbClient,
    );
    return rowToValue(row);
  });
}

export async function updateCustomValue(
  id: string,
  patch: CustomValuePatch,
): Promise<CustomValueRow> {
  const ctx = await getActorContext();
  const parsed = CustomValuePatchSchema.parse(patch);

  const existingRows = await db
    .select()
    .from(entityCustomValues)
    .where(and(eq(entityCustomValues.id, id), isNull(entityCustomValues.deletedAt)))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) throw new AppError('not_found', `Custom value ${id} not found`);
  requireCapability(ctx, updateCapabilityFor(existing.entityType));

  const field = await fieldOrThrow(existing.formFieldId);
  validateValueForType(parsed.value, field.type);

  const [row] = await db
    .update(entityCustomValues)
    .set({ value: parsed.value as never, updatedBy: ctx.userId })
    .where(eq(entityCustomValues.id, id))
    .returning();
  if (!row) throw new AppError('internal', 'entity_custom_values update returned no row');

  await logActivity({
    entityType: existing.entityType,
    entityId: existing.entityId,
    actorId: ctx.userId,
    kind: 'form_field.value_changed',
    summary: `Updated ${field.label}`,
    payload: { formFieldId: existing.formFieldId, formFieldKey: field.key },
  });
  return rowToValue(row);
}

export async function softDeleteCustomValue(id: string): Promise<void> {
  const ctx = await getActorContext();
  const existingRows = await db
    .select()
    .from(entityCustomValues)
    .where(and(eq(entityCustomValues.id, id), isNull(entityCustomValues.deletedAt)))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) throw new AppError('not_found', `Custom value ${id} not found`);

  const isPartnerOrAdmin = ctx.role === 'partner' || ctx.role === 'admin';
  const isCreator = existing.createdBy === ctx.userId;
  if (!isPartnerOrAdmin && !isCreator) {
    requireCapability(ctx, updateCapabilityFor(existing.entityType));
  }

  await db
    .update(entityCustomValues)
    .set({ deletedAt: new Date(), updatedBy: ctx.userId })
    .where(eq(entityCustomValues.id, id));
}

export async function restoreCustomValue(id: string): Promise<CustomValueRow> {
  const ctx = await getActorContext();
  const existingRows = await db
    .select()
    .from(entityCustomValues)
    .where(eq(entityCustomValues.id, id))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) throw new AppError('not_found', `Custom value ${id} not found`);
  if (!existing.deletedAt) return rowToValue(existing);

  const isPartnerOrAdmin = ctx.role === 'partner' || ctx.role === 'admin';
  const isCreator = existing.createdBy === ctx.userId;
  if (!isPartnerOrAdmin && !isCreator) {
    requireCapability(ctx, updateCapabilityFor(existing.entityType));
  }

  const [row] = await db
    .update(entityCustomValues)
    .set({ deletedAt: null, updatedBy: ctx.userId })
    .where(eq(entityCustomValues.id, id))
    .returning();
  if (!row) throw new AppError('internal', 'entity_custom_values restore returned no row');
  return rowToValue(row);
}

export async function hardDeleteCustomValue(id: string): Promise<void> {
  const ctx = await getActorContext();
  if (ctx.role !== 'partner' && ctx.role !== 'admin') {
    throw new AppError(
      'forbidden',
      'Hard delete of a custom value is restricted to partner / admin.',
      { detail: { role: ctx.role } },
    );
  }
  await db.delete(entityCustomValues).where(eq(entityCustomValues.id, id));
}
