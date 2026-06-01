import {
  char,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { entityTypeEnum } from './_polymorphic';

/**
 * Per-party billing defaults (one row per client or vendor). Pre-fills
 * the invoice / bill composer so accountants don't re-type terms,
 * place of supply, default TDS section, etc.
 *
 * Polymorphic on (`entityType`, `entityId`) so the same shape works
 * for client AR profiles and vendor AP profiles. Polymorphic-CHECK
 * trigger validates the pair resolves in the matching principal
 * table (added to `0004_polymorphic_check_trigger.sql` via a follow-up
 * migration if scope grows; for v1 we trust server-action discipline).
 */
export const partyDefaultPaymentMethodEnum = pgEnum('party_default_payment_method', [
  'bank_transfer',
  'upi',
  'card',
  'cheque',
  'cash',
  'razorpay',
]);

export const partyBillingProfiles = pgTable(
  'party_billing_profiles',
  {
    ...timestamps(),
    ...auditColumns(),
    entityType: entityTypeEnum().notNull(), // 'client' | 'vendor'
    entityId: uuid().notNull(),
    defaultPaymentTermsDays: integer().notNull().default(30),
    defaultPlaceOfSupply: char({ length: 2 }), // state code; e.g. '27' for Maharashtra
    defaultTdsSection: text(), // '194J', '194C', etc.; vendor-side
    defaultPaymentMethod: partyDefaultPaymentMethodEnum(),
    defaultCurrency: char({ length: 3 }).notNull().default('INR'),
    notes: text(),
  },
  (t) => [
    uniqueIndex('party_billing_profiles_entity_unique').on(t.entityType, t.entityId),
    index().on(t.entityType),
  ],
);

export type PartyBillingProfile = typeof partyBillingProfiles.$inferSelect;
export type NewPartyBillingProfile = typeof partyBillingProfiles.$inferInsert;
