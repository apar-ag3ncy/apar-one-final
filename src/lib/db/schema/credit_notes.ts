import {
  bigint,
  boolean,
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
import { invoices } from './invoices';
import { transactions } from './transactions';

/**
 * Credit notes (Apar → client). Always linked to an `originalInvoiceId`
 * (mandatory, FK ON DELETE RESTRICT). Credit notes are the ONLY way to
 * "edit" a posted invoice — direct edits are blocked by
 * `tg_block_edit_sent_invoices`.
 *
 * `gstImpactAllowed` is set at creation time by the server action based
 * on CGST Act §34(2): a credit note may reverse GST output liability
 * only if issued before the earlier of (a) Nov 30 of the FY following
 * the original invoice's FY OR (b) the date GSTR-9 is filed for the
 * original invoice's FY. After that window, the credit note is
 * commercial-only and does NOT reverse GST output — the posting
 * template skips the `2120 GST Output Payable` reversal leg.
 *
 * Validation rule `credit_note_outside_window` (warn) flags credit
 * notes issued past the deadline.
 */
export const creditNoteStateEnum = pgEnum('credit_note_state', ['draft', 'issued', 'void']);

export const creditNotes = pgTable(
  'credit_notes',
  {
    ...timestamps(),
    ...auditColumns(),
    documentNumber: text().notNull(),
    documentDate: date().notNull(),
    financialYearStart: date().notNull(),
    clientId: uuid()
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    originalInvoiceId: uuid()
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    state: creditNoteStateEnum().notNull().default('draft'),
    reason: text().notNull(),

    subtotalPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    capturedTaxTotalPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    capturedTotalPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    placeOfSupply: char({ length: 2 }),
    capturedTaxSplit: jsonb().notNull().default({}),

    gstImpactAllowed: boolean().notNull().default(true),

    notes: text(),

    idempotencyKey: text().notNull(),
    issuedAt: timestamp({ withTimezone: true }),

    sourceDocumentId: uuid().references(() => documents.id, { onDelete: 'set null' }),
    postedTransactionId: uuid().references(() => transactions.id, { onDelete: 'restrict' }),

    validationFlags: jsonb().notNull().default([]),
  },
  (t) => [
    uniqueIndex('credit_notes_document_number_per_fy_unique').on(
      t.financialYearStart,
      t.documentNumber,
    ),
    uniqueIndex('credit_notes_idempotency_key_unique').on(t.idempotencyKey),
    index().on(t.originalInvoiceId),
    index().on(t.clientId, t.documentDate.desc()),
    index().on(t.state),
  ],
);

export type CreditNote = typeof creditNotes.$inferSelect;
export type NewCreditNote = typeof creditNotes.$inferInsert;
