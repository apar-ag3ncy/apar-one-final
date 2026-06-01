import { index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { entityTypeEnum } from './_polymorphic';

export const taxIdentifierKindEnum = pgEnum('tax_identifier_kind', [
  'pan',
  'gstin',
  'tan',
  'msme_udyam',
  'lut',
  'aadhaar', // employees only; vault-only
]);

/**
 * Polymorphic tax identifiers. Same vault discipline as
 * `entity_bank_accounts`:
 *   - `maskedValue` on the row for display ('XXXXXX1234X')
 *   - `vaultObjectKey` points to the encrypted blob
 *   - reveal via `lib/storage.ts:revealKyc` with `reveal_kyc` capability
 *     + 60s signed URL + audit log
 *
 * GSTIN is the one exception that can be stored unmasked — it's
 * already public on every invoice. We still pass it through this table
 * for unified querying / Form Builder, with `maskedValue=`<gstin>` and
 * `vaultObjectKey` empty / pointing to a copy if you want auditing.
 *
 * **Aadhaar** is always vault-only and only valid for `employee` entities.
 */
export const entityTaxIdentifiers = pgTable(
  'entity_tax_identifiers',
  {
    ...timestamps(),
    ...auditColumns(),
    entityType: entityTypeEnum().notNull(),
    entityId: uuid().notNull(),
    kind: taxIdentifierKindEnum().notNull(),
    maskedValue: text().notNull(),
    vaultObjectKey: text(), // nullable for already-public identifiers like GSTIN
    issuedOn: text(), // ISO date as text; relaxed for legacy data
    expiresOn: text(),
    notes: text(),
  },
  (t) => [index().on(t.entityType, t.entityId), index().on(t.kind)],
);

export type EntityTaxIdentifier = typeof entityTaxIdentifiers.$inferSelect;
export type NewEntityTaxIdentifier = typeof entityTaxIdentifiers.$inferInsert;
