import {
  boolean,
  char,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';

/**
 * Billing-module singleton settings. One row only — enforced by the
 * `billing_settings_singleton_unique` partial-unique-index on
 * `(singleton)` where `singleton = true`. The seeder in 0019 inserts
 * the initial row; the partner admin UI updates it in place.
 *
 * Distinct from the generic `settings` key/value table because the
 * billing shape needs typed columns (PDF preferences, number format
 * masks, default gateway choice). Keeping them here keeps the generic
 * settings table from devolving into a giant grab-bag.
 */
export const gatewayDefaultEnum = pgEnum('gateway_default', ['razorpay', 'manual']);

export const billingSettings = pgTable(
  'billing_settings',
  {
    ...timestamps(),
    ...auditColumns(),
    singleton: boolean().notNull().default(true),

    // Default place of supply (Apar's home state — Maharashtra '27').
    companyDefaultPlaceOfSupply: char({ length: 2 }).notNull().default('27'),

    // Numbering — used by the next-document-number RPC (Phase 2).
    invoiceNumberPrefix: text().notNull().default('INV'),
    invoiceNumberFormat: text().notNull().default('{prefix}/{fy}/{seq:04}'),
    creditNoteNumberPrefix: text().notNull().default('CN'),
    estimateNumberPrefix: text().notNull().default('EST'),
    receiptNumberPrefix: text().notNull().default('RCT'),
    receiptVoucherNumberPrefix: text().notNull().default('RV'),
    refundVoucherNumberPrefix: text().notNull().default('REF'),

    // FY start month (India is April; configurable for org-tenant generality later).
    fyStartMonth: integer().notNull().default(4),

    defaultPaymentTermsDays: integer().notNull().default(30),
    gatewayDefault: gatewayDefaultEnum().notNull().default('manual'),
    eInvoicingEnabled: boolean().notNull().default(false),
  },
  (t) => [
    // Singleton: only one row may have singleton = true.
    uniqueIndex('billing_settings_singleton_unique').on(t.singleton),
    index().on(t.singleton),
  ],
);

export type BillingSettings = typeof billingSettings.$inferSelect;
export type NewBillingSettings = typeof billingSettings.$inferInsert;
