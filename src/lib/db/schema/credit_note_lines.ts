import { bigint, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { creditNotes } from './credit_notes';
import { invoiceLines } from './invoice_lines';
import { serviceItems } from './service_items';

/**
 * Credit-note line items. Mirrors `invoice_lines` plus an optional
 * back-pointer (`originalInvoiceLineId`) to the line being credited.
 *
 * Validation rule `credit_note_exceeds_invoice_line` (warn) compares
 * the cumulative credit on each original line and warns if it crosses
 * the invoiced amount.
 */
export const creditNoteLines = pgTable(
  'credit_note_lines',
  {
    ...timestamps(),
    ...auditColumns(),
    creditNoteId: uuid()
      .notNull()
      .references(() => creditNotes.id, { onDelete: 'cascade' }),
    lineNo: integer().notNull(),
    originalInvoiceLineId: uuid().references(() => invoiceLines.id, { onDelete: 'set null' }),
    serviceItemId: uuid().references(() => serviceItems.id, { onDelete: 'set null' }),
    description: text().notNull(),
    sacCode: text(),

    qty: integer().notNull().default(1),
    ratePaise: bigint({ mode: 'bigint' }).notNull().default(0n),

    capturedTaxableValuePaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    capturedTaxRateBps: integer().notNull().default(0),
    capturedTaxAmountPaise: bigint({ mode: 'bigint' }).notNull().default(0n),

    postingAccountCode: text().notNull().default('4100'),
  },
  (t) => [
    uniqueIndex('credit_note_lines_cn_line_no_unique').on(t.creditNoteId, t.lineNo),
    index().on(t.creditNoteId),
    index().on(t.originalInvoiceLineId),
  ],
);

export type CreditNoteLine = typeof creditNoteLines.$inferSelect;
export type NewCreditNoteLine = typeof creditNoteLines.$inferInsert;
