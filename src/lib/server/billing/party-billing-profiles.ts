'use server';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { partyBillingProfiles } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

/**
 * party_billing_profiles — one profile per (entityType, entityId) pair.
 * Polymorphic over client and vendor (the only entity types currently
 * exercised for billing). Capability: `manage_party_billing_profile`.
 *
 * Pre-fills the invoice / bill composer so accountants don't re-type
 * default payment terms, default place of supply, default TDS section,
 * preferred payment method per party.
 *
 * Upsert semantics: there's exactly one row per (entityType, entityId)
 * — enforced by `party_billing_profiles_entity_unique`. `upsertProfile`
 * inserts on first call, updates thereafter.
 */

const EntityRefSchema = z.object({
  entityType: z.enum(['client', 'vendor']),
  entityId: z.string().uuid(),
});

const ProfileInputSchema = EntityRefSchema.extend({
  defaultPaymentTermsDays: z.number().int().min(0).max(365).optional(),
  defaultPlaceOfSupply: z
    .string()
    .trim()
    .length(2)
    .regex(/^[0-9]{2}$/, '2-digit state code')
    .nullish(),
  defaultTdsSection: z.string().trim().max(20).nullish(),
  defaultPaymentMethod: z
    .enum(['bank_transfer', 'upi', 'card', 'cheque', 'cash', 'razorpay'])
    .nullish(),
  defaultCurrency: z.string().trim().length(3).optional(),
  notes: z.string().trim().max(1000).nullish(),
});

export type PartyBillingProfileInput = z.input<typeof ProfileInputSchema>;

export async function getPartyBillingProfile(
  entityType: 'client' | 'vendor',
  entityId: string,
): Promise<typeof partyBillingProfiles.$inferSelect | null> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_party_billing_profile');
  const ref = EntityRefSchema.parse({ entityType, entityId });

  const [row] = await db
    .select()
    .from(partyBillingProfiles)
    .where(
      and(
        eq(partyBillingProfiles.entityType, ref.entityType),
        eq(partyBillingProfiles.entityId, ref.entityId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function upsertPartyBillingProfile(
  input: PartyBillingProfileInput,
): Promise<{ id: string }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_party_billing_profile');

  const v = ProfileInputSchema.parse(input);

  // Single statement upsert via ON CONFLICT on the (entityType, entityId)
  // unique constraint. Avoids the SELECT-then-INSERT race.
  const [row] = await db
    .insert(partyBillingProfiles)
    .values({
      entityType: v.entityType,
      entityId: v.entityId,
      defaultPaymentTermsDays: v.defaultPaymentTermsDays ?? 30,
      defaultPlaceOfSupply: v.defaultPlaceOfSupply ?? null,
      defaultTdsSection: v.defaultTdsSection ?? null,
      defaultPaymentMethod: v.defaultPaymentMethod ?? null,
      defaultCurrency: v.defaultCurrency ?? 'INR',
      notes: v.notes ?? null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .onConflictDoUpdate({
      target: [partyBillingProfiles.entityType, partyBillingProfiles.entityId],
      set: {
        defaultPaymentTermsDays: v.defaultPaymentTermsDays ?? 30,
        defaultPlaceOfSupply: v.defaultPlaceOfSupply ?? null,
        defaultTdsSection: v.defaultTdsSection ?? null,
        defaultPaymentMethod: v.defaultPaymentMethod ?? null,
        defaultCurrency: v.defaultCurrency ?? 'INR',
        notes: v.notes ?? null,
        updatedBy: ctx.userId,
        updatedAt: new Date(),
      },
    })
    .returning({ id: partyBillingProfiles.id });

  if (!row) {
    throw new AppError('internal', 'party_billing_profiles upsert returned no row');
  }
  return { id: row.id };
}

export async function deletePartyBillingProfile(
  entityType: 'client' | 'vendor',
  entityId: string,
): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_party_billing_profile');
  const ref = EntityRefSchema.parse({ entityType, entityId });

  await db
    .delete(partyBillingProfiles)
    .where(
      and(
        eq(partyBillingProfiles.entityType, ref.entityType),
        eq(partyBillingProfiles.entityId, ref.entityId),
      ),
    );
}
