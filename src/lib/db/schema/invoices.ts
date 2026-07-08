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
import { companyBankAccounts } from './company_bank_accounts';
import { documents } from './documents';
import { entityAddresses } from './entity_addresses';
import { invoiceThemes } from './invoice_themes';
import { projects } from './projects';
import { transactions } from './transactions';

/**
 * Invoice headers (Apar → client). One row per invoice. Lines live in
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

/**
 * Document type. A `proforma` is presented (and titled on the PDF) as a
 * proforma; per the product decision it otherwise behaves exactly like a tax
 * `invoice` (same numbering series + ledger posting on send). Frozen once the
 * invoice leaves `draft` (immutability trigger), so a sent document's nature
 * cannot change after the fact.
 */
export const invoiceTypeEnum = pgEnum('invoice_type', ['invoice', 'proforma']);

export const invoices = pgTable(
  'invoices',
  {
    ...timestamps(),
    ...auditColumns(),
    documentNumber: text().notNull(), // e.g. 'INV/2025-26/0001'
    documentType: invoiceTypeEnum().notNull().default('invoice'),
    documentDate: date().notNull(),
    dueDate: date(),
    financialYearStart: date().notNull(), // April 1 of the FY (e.g. '2025-04-01')
    clientId: uuid()
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    /**
     * Header-level project link — the DEFAULT project for lines without their
     * own `invoice_lines.projectId` (0062). Since 0062 this column is exempt
     * from the sent-invoice freeze (management attribution, not part of the
     * legal artifact), so an already-sent invoice can be (re)linked.
     */
    projectId: uuid().references(() => projects.id, { onDelete: 'restrict' }),
    /**
     * Proforma → invoice conversion linkage (0062): the tax invoice created
     * by converting a proforma records the proforma's id here. Self-FK
     * (SET NULL) lives in the SQL migration — kept a plain uuid like
     * transactions.reversesId. Backfilled from the
     * 'proforma-conv:<id>' idempotency-key convention.
     */
    convertedFromInvoiceId: uuid(),
    /**
     * "Covered under a retainer" (0062) — flags an invoice as billing work a
     * client retainer covers. Pure capture; badge in lists, no posting
     * impact. Editable after send (a mis-tag must be fixable).
     */
    coveredUnderRetainer: boolean().notNull().default(false),
    // Chosen bill-to address (one of the client's entity_addresses). Nullable:
    // when unset, the PDF falls back to the client's registered/primary address.
    // ON DELETE SET NULL — the address can be removed without orphaning the
    // invoice; the sent PDF already snapshots the address text, so the legal
    // artifact is unaffected.
    billToAddressId: uuid().references(() => entityAddresses.id, { onDelete: 'set null' }),
    state: invoiceStateEnum().notNull().default('draft'),

    // USER-ENTERED amounts. We do not compute.
    subtotalPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    capturedTaxTotalPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    capturedTotalPaise: bigint({ mode: 'bigint' }).notNull().default(0n),

    placeOfSupply: char({ length: 2 }), // 2-digit state code; required when sent
    capturedTaxSplit: jsonb().notNull().default({}), // {cgst_paise, sgst_paise, igst_paise, cess_paise}

    terms: text(),
    notes: text(),

    // Selected invoice theme (visual skin for the generated PDF). Nullable —
    // resolved to the default theme at render time when unset. Set while the
    // invoice is still a draft; the immutability trigger blocks edits after.
    themeId: uuid().references(() => invoiceThemes.id, { onDelete: 'set null' }),

    // Which company bank account prints in the payment block. Nullable —
    // resolved to the primary account at render time when unset. Set while the
    // invoice is a draft; the immutability trigger (0044) freezes it after send.
    // ON DELETE SET NULL: an account can be retired without orphaning past
    // invoices, whose stored PDFs already snapshot the account details.
    bankAccountId: uuid().references(() => companyBankAccounts.id, { onDelete: 'set null' }),

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
    index().on(t.convertedFromInvoiceId),
    index().on(t.billToAddressId),
    index().on(t.bankAccountId),
    index().on(t.state),
    index().on(t.dueDate),
    index().on(t.sentAt),
    index().on(t.razorpayPaymentLinkId),
  ],
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
