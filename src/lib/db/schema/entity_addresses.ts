import { boolean, index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { entityTypeEnum } from './_polymorphic';

export const addressKindEnum = pgEnum('address_kind', [
  'billing',
  'shipping',
  'registered',
  'site',
  'home',
]);

/**
 * Polymorphic addresses. A client may have multiple GSTIN-bearing
 * addresses across states (AUDIT-GAPS §1.1). Per-address GSTIN is
 * stored on this table; the principal entity's GSTIN column holds the
 * primary one for invoices.
 */
export const entityAddresses = pgTable(
  'entity_addresses',
  {
    ...timestamps(),
    ...auditColumns(),
    entityType: entityTypeEnum().notNull(),
    entityId: uuid().notNull(),
    kind: addressKindEnum().notNull(),
    line1: text().notNull(),
    line2: text(),
    city: text().notNull(),
    stateCode: text().notNull(), // 'MH', 'KA', 'DL' — drives intra/inter-state classification
    postalCode: text(),
    country: text().notNull().default('IN'),
    gstin: text(), // optional per-address GSTIN
    isPrimary: boolean().notNull().default(false),
    notes: text(),
  },
  (t) => [index().on(t.entityType, t.entityId), index().on(t.kind), index().on(t.stateCode)],
);

export type EntityAddress = typeof entityAddresses.$inferSelect;
export type NewEntityAddress = typeof entityAddresses.$inferInsert;
