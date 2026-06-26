import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { clients } from './clients';
import { documents } from './documents';
import { projects } from './projects';
import { transactions } from './transactions';
import { vendors } from './vendors';

/**
 * Vendor bills (vendor → Apar). Headers; lines live in `bill_lines`.
 *
 * Attribution (LEDGER-SPEC §0.6 + §3.4): every bill MUST carry one of
 *   - `client`  → on-behalf-of-client, `onBehalfOfClientId` required
 *   - `opex`    → Apar internal cost, `opexAccountCode` required
 *   - `asset`   → capitalisable (≥ ₹5k by convention), posts to 1510
 *
 * The existing posting template at
 * `lib/server/ledger/postings/vendorBill.ts` already refuses to post
 * without explicit attribution; this header table just persists the
 * answer so the bill list / per-client P&L join can filter on it
 * without re-deriving from postings metadata.
 *
 * TDS fields are USER-ENTERED (captured-not-computed). The validation
 * rule `tds_threshold_crossed` (warn) checks cumulative payments to
 * the vendor in the FY against the section's threshold and warns if
 * TDS should have been deducted but wasn't.
 */
export const billStateEnum = pgEnum('bill_state', [
  'draft',
  'recorded',
  'partially_paid',
  'paid',
  'void',
]);

export const billAttributionEnum = pgEnum('bill_attribution', ['client', 'opex', 'asset']);

export const bills = pgTable(
  'bills',
  {
    ...timestamps(),
    ...auditColumns(),
    documentNumber: text().notNull(), // vendor's invoice number (their reference, not ours)
    documentDate: date().notNull(),
    dueDate: date(),
    financialYearStart: date().notNull(),
    vendorId: uuid()
      .notNull()
      .references(() => vendors.id, { onDelete: 'restrict' }),

    // Attribution + dependents
    attribution: billAttributionEnum().notNull(),
    onBehalfOfClientId: uuid().references(() => clients.id, { onDelete: 'restrict' }),
    projectId: uuid().references(() => projects.id, { onDelete: 'restrict' }),
    opexAccountCode: text(), // required when attribution = 'opex'

    state: billStateEnum().notNull().default('draft'),

    subtotalPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    capturedTaxTotalPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    capturedTotalPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    placeOfSupply: char({ length: 2 }),
    capturedTaxSplit: jsonb().notNull().default({}),

    // Vendor-side TDS captured at bill-creation time
    capturedTdsAmountPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    capturedTdsSection: text(),
    capturedTdsRateBps: integer().notNull().default(0),

    isRcm: boolean().notNull().default(false),

    notes: text(),

    idempotencyKey: text().notNull(),
    recordedAt: timestamp({ withTimezone: true }),

    sourceDocumentId: uuid().references(() => documents.id, { onDelete: 'restrict' }),
    postedTransactionId: uuid().references(() => transactions.id, { onDelete: 'restrict' }),

    validationFlags: jsonb().notNull().default([]),
  },
  (t) => [
    uniqueIndex('bills_vendor_document_number_unique').on(t.vendorId, t.documentNumber),
    uniqueIndex('bills_idempotency_key_unique').on(t.idempotencyKey),
    index().on(t.vendorId, t.documentDate.desc()),
    index().on(t.onBehalfOfClientId, t.documentDate.desc()),
    index().on(t.projectId),
    index().on(t.state),
    index().on(t.attribution),
    index().on(t.dueDate),
  ],
);

export type Bill = typeof bills.$inferSelect;
export type NewBill = typeof bills.$inferInsert;
