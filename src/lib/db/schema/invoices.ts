import {
  bigint,
  char,
  date,
  index,
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

/**
 * Invoice headers (Apār → client). One row per invoice. Lines live in
 * `invoice_lines`. Captured-not-computed (CLAUDE rule #1, #2):
 *
 *   - `subtotalPaise`, `capturedTaxTotalPaise`, `capturedTotalPaise`
 *     are USER-ENTERED. The validation engine warns if the math doesn't
 *     reconcile (`invoice_total_mismatch`) but never auto-corrects.
 *   - `capturedTaxSplit` is `{cgst_paise, sgst_paise, igst_paise,
 *     cess_paise}` — also user-entered. `gst_split_mismatch` warns if
 *     the components don't sum to `capturedTaxTotalPaise`.
 *
 * No-edit-on-posted (LEDGER-SPEC §8.4 + brief): once `state` flips
 * from `draft` to anything else, only a small whitelist of columns
 * (state, sentAt, viewedAt, validationFlags, notes,
 * razorpayPaymentLinkId*, postedTransactionId) is editable. Trigger
 * `tg_block_edit_sent_invoices` in 0019 enforces this at the DB.
 *
 * Drafts MAY be soft-deleted (`deletedAt`); non-drafts may NOT
 * (`tg_block_delete_sent_invoices` trigger).
 *
 * `documentNumber` is unique within `financialYearStart`. `idempotencyKey`
 * is globally unique to defeat double-submit on the create endpoint.
 */
export const invoiceStateEnum = pgEnum('invoice_state', [
  'draft',
  'sent',
  'partially_paid',
  'paid',
  'void',
]);

export const invoices = pgTable(
  'invoices',
  {
    ...timestamps(),
    ...auditColumns(),
    documentNumber: text().notNull(), // e.g. 'INV/2025-26/0001'
    documentDate: date().notNull(),
    dueDate: date(),
    financialYearStart: date().notNull(), // April 1 of the FY (e.g. '2025-04-01')
    clientId: uuid()
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    projectId: uuid().references(() => projects.id, { onDelete: 'restrict' }),
    state: invoiceStateEnum().notNull().default('draft'),

    // USER-ENTERED amounts. We do not compute.
    subtotalPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    capturedTaxTotalPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    capturedTotalPaise: bigint({ mode: 'bigint' }).notNull().default(0n),

    placeOfSupply: char({ length: 2 }), // 2-digit state code; required when sent
    capturedTaxSplit: jsonb().notNull().default({}), // {cgst_paise, sgst_paise, igst_paise, cess_paise}

    terms: text(),
    notes: text(),

    idempotencyKey: text().notNull(),
    sentAt: timestamp({ withTimezone: true }),
    viewedAt: timestamp({ withTimezone: true }),

    sourceDocumentId: uuid().references(() => documents.id, { onDelete: 'set null' }), // generated PDF
    postedTransactionId: uuid().references(() => transactions.id, { onDelete: 'restrict' }), // ledger txn once sent

    razorpayPaymentLinkId: text(),
    razorpayPaymentLinkUrl: text(),

    validationFlags: jsonb().notNull().default([]),
  },
  (t) => [
    uniqueIndex('invoices_document_number_per_fy_unique').on(
      t.financialYearStart,
      t.documentNumber,
    ),
    uniqueIndex('invoices_idempotency_key_unique').on(t.idempotencyKey),
    index().on(t.clientId, t.documentDate.desc()),
    index().on(t.projectId),
    index().on(t.state),
    index().on(t.dueDate),
    index().on(t.sentAt),
    index().on(t.razorpayPaymentLinkId),
  ],
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
