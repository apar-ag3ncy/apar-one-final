'use server';

import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { logActivity } from '@/lib/activity';
import { db, type DbClient } from '@/lib/db/client';
import { entityContacts } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability, type Capability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

const entityTypeSchema = z.enum(['client', 'vendor', 'employee', 'project', 'office']);

/**
 * SPEC-AMENDMENT-001 §1: at least one of email or phone is required. The
 * DB has the same CHECK; this is the friendlier validation layer.
 */
const ContactInputSchema = z
  .object({
    entityType: entityTypeSchema,
    entityId: z.string().uuid(),
    name: z.string().min(1, 'Name is required').max(120),
    role: z.string().max(120).optional().nullable(),
    email: z.string().email().optional().nullable(),
    phone: z.string().max(40).optional().nullable(),
    isPrimary: z.boolean().default(false),
    notes: z.string().max(2000).optional().nullable(),
  })
  .refine((v) => (v.email ?? '').length > 0 || (v.phone ?? '').length > 0, {
    message: 'Provide at least one of email or phone.',
    path: ['email'],
  });

const ContactPatchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    role: z.string().max(120).optional().nullable(),
    email: z.string().email().optional().nullable(),
    phone: z.string().max(40).optional().nullable(),
    isPrimary: z.boolean().optional(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .refine(
    (v) => {
      // Only enforce email-or-phone if both fields are being explicitly cleared.
      if (v.email === null && v.phone === null) return false;
      return true;
    },
    {
      message: 'Provide at least one of email or phone.',
      path: ['email'],
    },
  );

export type ContactInput = z.infer<typeof ContactInputSchema>;
export type ContactPatch = z.infer<typeof ContactPatchSchema>;

export type ContactRow = {
  id: string;
  entityType: 'client' | 'vendor' | 'employee' | 'project' | 'office';
  entityId: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  notes: string | null;
};

function rowToContact(r: typeof entityContacts.$inferSelect): ContactRow {
  return {
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    name: r.name,
    role: r.role,
    email: r.email,
    phone: r.phone,
    isPrimary: r.isPrimary,
    notes: r.notes,
  };
}

/**
 * Capability map for the principal-entity context this contact belongs to.
 * Used to gate create/update/soft-delete. Hard-delete uses partner-only
 * (bypassed for partner role inside requireCapability).
 */
function updateCapabilityFor(entityType: ContactInput['entityType']): Capability {
  switch (entityType) {
    case 'client':
      return 'update_client';
    case 'vendor':
      return 'update_vendor';
    case 'employee':
      return 'update_employee';
    case 'project':
      // No explicit project capability; reuse update_client (manager+) as the
      // closest proxy until the project capabilities land.
      return 'update_client';
    case 'office':
      // Office contacts are partner/admin work; partner bypasses anyway.
      return 'update_client';
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listContacts(args: {
  entityType: ContactInput['entityType'];
  entityId: string;
  includeArchived?: boolean;
}): Promise<readonly ContactRow[]> {
  await getActorContext(); // require auth even for reads
  const where = and(
    eq(entityContacts.entityType, args.entityType),
    eq(entityContacts.entityId, args.entityId),
    args.includeArchived ? undefined : isNull(entityContacts.deletedAt),
  );
  const rows = await db
    .select()
    .from(entityContacts)
    .where(where)
    .orderBy(desc(entityContacts.isPrimary), entityContacts.name);
  return rows.map(rowToContact);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createContact(input: ContactInput): Promise<ContactRow> {
  const ctx = await getActorContext();
  const parsed = ContactInputSchema.parse(input);
  requireCapability(ctx, updateCapabilityFor(parsed.entityType));

  // If marking as primary, demote existing primaries for this entity in the
  // same transaction so there is at most one primary.
  return await db.transaction(async (tx) => {
    if (parsed.isPrimary) {
      await tx
        .update(entityContacts)
        .set({ isPrimary: false, updatedBy: ctx.userId })
        .where(
          and(
            eq(entityContacts.entityType, parsed.entityType),
            eq(entityContacts.entityId, parsed.entityId),
            eq(entityContacts.isPrimary, true),
            isNull(entityContacts.deletedAt),
          ),
        );
    }
    const [row] = await tx
      .insert(entityContacts)
      .values({
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        name: parsed.name,
        role: parsed.role ?? null,
        email: parsed.email ?? null,
        phone: parsed.phone ?? null,
        isPrimary: parsed.isPrimary,
        notes: parsed.notes ?? null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    if (!row) throw new AppError('internal', 'entity_contacts insert returned no row');

    // Real-time feed: emit a typed activity event so the entity profile's
    // Activity tab picks the new contact up via Supabase Realtime + 15s
    // polling fallback. Without this the contact is in the DB but invisible
    // on the dashboard until the user manually refreshes.
    await logActivity(
      {
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        actorId: ctx.userId,
        kind: parsed.isPrimary ? 'contact.primary_promoted' : 'contact.added',
        summary: `Added contact ${parsed.name}${parsed.role ? ` (${parsed.role})` : ''}`,
        payload: {
          contact_id: row.id,
          name: parsed.name,
          role: parsed.role ?? null,
          email: parsed.email ?? null,
          phone: parsed.phone ?? null,
          is_primary: parsed.isPrimary,
        },
      },
      tx as unknown as DbClient,
    );
    return rowToContact(row);
  });
}

export async function updateContact(id: string, patch: ContactPatch): Promise<ContactRow> {
  const ctx = await getActorContext();
  const parsed = ContactPatchSchema.parse(patch);

  // Look up the row to determine entity type for the capability check.
  const existingRows = await db
    .select()
    .from(entityContacts)
    .where(and(eq(entityContacts.id, id), isNull(entityContacts.deletedAt)))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) throw new AppError('not_found', `Contact ${id} not found`);
  requireCapability(ctx, updateCapabilityFor(existing.entityType));

  return await db.transaction(async (tx) => {
    if (parsed.isPrimary === true) {
      await tx
        .update(entityContacts)
        .set({ isPrimary: false, updatedBy: ctx.userId })
        .where(
          and(
            eq(entityContacts.entityType, existing.entityType),
            eq(entityContacts.entityId, existing.entityId),
            eq(entityContacts.isPrimary, true),
            isNull(entityContacts.deletedAt),
          ),
        );
    }
    const [row] = await tx
      .update(entityContacts)
      .set({
        name: parsed.name ?? existing.name,
        role: parsed.role === undefined ? existing.role : parsed.role,
        email: parsed.email === undefined ? existing.email : parsed.email,
        phone: parsed.phone === undefined ? existing.phone : parsed.phone,
        isPrimary: parsed.isPrimary ?? existing.isPrimary,
        notes: parsed.notes === undefined ? existing.notes : parsed.notes,
        updatedBy: ctx.userId,
      })
      .where(eq(entityContacts.id, id))
      .returning();
    if (!row) throw new AppError('internal', 'entity_contacts update returned no row');

    // Real-time feed: surface the edit on the Activity tab. The
    // primary-promotion case gets a distinct event kind so timelines can
    // pick it out for the "primary contact changed" highlight.
    const becamePrimary = parsed.isPrimary === true && existing.isPrimary === false;
    await logActivity(
      {
        entityType: existing.entityType,
        entityId: existing.entityId,
        actorId: ctx.userId,
        kind: becamePrimary ? 'contact.primary_promoted' : 'contact.added',
        summary: becamePrimary
          ? `Promoted ${row.name} to primary contact`
          : `Updated contact ${row.name}`,
        payload: { contact_id: row.id, is_primary: row.isPrimary },
      },
      tx as unknown as DbClient,
    );
    return rowToContact(row);
  });
}

/** Soft delete — admin / partner / record creator. */
export async function softDeleteContact(id: string): Promise<void> {
  const ctx = await getActorContext();
  const existingRows = await db
    .select()
    .from(entityContacts)
    .where(and(eq(entityContacts.id, id), isNull(entityContacts.deletedAt)))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) throw new AppError('not_found', `Contact ${id} not found`);

  // Partner / admin can soft-delete any contact. Manager can soft-delete
  // contacts they created (record-creator clause). Otherwise denied.
  const isPartnerOrAdmin = ctx.role === 'partner' || ctx.role === 'admin';
  const isCreator = existing.createdBy === ctx.userId;
  if (!isPartnerOrAdmin && !isCreator) {
    requireCapability(ctx, updateCapabilityFor(existing.entityType));
  }

  await db
    .update(entityContacts)
    .set({ deletedAt: new Date(), updatedBy: ctx.userId })
    .where(eq(entityContacts.id, id));

  await logActivity({
    entityType: existing.entityType,
    entityId: existing.entityId,
    actorId: ctx.userId,
    kind: 'contact.removed',
    summary: `Removed contact ${existing.name}`,
    payload: { contact_id: id, name: existing.name },
  });
}

/** Restore a previously soft-deleted contact. Same role gate as soft-delete. */
export async function restoreContact(id: string): Promise<ContactRow> {
  const ctx = await getActorContext();
  const existingRows = await db
    .select()
    .from(entityContacts)
    .where(eq(entityContacts.id, id))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) throw new AppError('not_found', `Contact ${id} not found`);
  if (!existing.deletedAt) {
    // Idempotent — already active.
    return rowToContact(existing);
  }

  const isPartnerOrAdmin = ctx.role === 'partner' || ctx.role === 'admin';
  const isCreator = existing.createdBy === ctx.userId;
  if (!isPartnerOrAdmin && !isCreator) {
    requireCapability(ctx, updateCapabilityFor(existing.entityType));
  }

  const [row] = await db
    .update(entityContacts)
    .set({ deletedAt: null, updatedBy: ctx.userId })
    .where(eq(entityContacts.id, id))
    .returning();
  if (!row) throw new AppError('internal', 'entity_contacts restore returned no row');
  return rowToContact(row);
}

/**
 * Hard delete — partner only. SPEC-AMENDMENT-001 §2.1.
 * No dependents check because POCs have no transactions referencing them
 * (POCs are contact records, not ledger participants).
 */
export async function hardDeleteContact(id: string): Promise<void> {
  const ctx = await getActorContext();
  if (ctx.role !== 'partner') {
    throw new AppError('forbidden', 'Hard delete of a contact is restricted to the partner role.', {
      detail: { role: ctx.role },
    });
  }

  // Snapshot the row for the activity event before the delete.
  const existingRows = await db
    .select()
    .from(entityContacts)
    .where(eq(entityContacts.id, id))
    .limit(1);
  const existing = existingRows[0];

  await db.delete(entityContacts).where(eq(entityContacts.id, id));

  if (existing) {
    await logActivity({
      entityType: existing.entityType,
      entityId: existing.entityId,
      actorId: ctx.userId,
      kind: 'contact.removed',
      summary: `Hard-deleted contact ${existing.name}`,
      payload: { contact_id: id, name: existing.name, hard_delete: true },
    });
  }
}
