import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { bankAccounts } from './bank_accounts';
import { clients } from './clients';
import { documents } from './documents';
import { transactions } from './transactions';

/**
 * Customer payment receipts. One row per inbound payment. Allocates
 * to one or more invoices via `payment_allocations`. An allocation
 * trigger enforces `SUM(allocated_paise) <= totalPaise` per receipt.
 *
 * For Razorpay receipts the webhook handler (Phase 4) inserts the row
 * with `method='razorpay'`, the `gatewayPaymentId`, the
 * `gatewayFeePaise`, and the `razorpayPaymentLinkId` so the matching
 * invoice can be looked up.
 *
 * Captured TDS deducted by the customer (when paying us): captured as
 * `capturedTdsAmountPaise` + section. The income tax credit
 * reconciliation report joins on `capturedTdsSection`.
 */
export const receiptMethodEnum = pgEnum('receipt_method', [
  'bank_transfer',
  'upi',
  'card',
  'cheque',
  'cash',
  'razorpay',
]);

export const receipts = pgTable(
  'receipts',
  {
    ...timestamps(),
    ...auditColumns(),
    receiptNumber: text().notNull(), // 'RCT/2025-26/0001'
    receiptDate: date().notNull(),
    financialYearStart: date().notNull(),
    clientId: uuid()
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    bankAccountId: uuid().references(() => bankAccounts.id, { onDelete: 'restrict' }), // null for cash
    totalPaise: bigint({ mode: 'bigint' }).notNull(),
    method: receiptMethodEnum().notNull(),

    // Gateway-specific
    gatewayPaymentId: text(),
    gatewayFeePaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    razorpayPaymentLinkId: text(),
    razorpayEventId: text(), // for webhook idempotency

    // TDS deducted by the customer when paying us
    capturedTdsAmountPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    capturedTdsSection: text(),
    capturedTdsRateBps: integer().notNull().default(0),

    // Cheque capture (0064) — set when method='cheque'.
    chequeNumber: text(),
    chequeDate: date(),

    notes: text(),

    sourceDocumentId: uuid().references(() => documents.id, { onDelete: 'set null' }),
    postedTransactionId: uuid().references(() => transactions.id, { onDelete: 'restrict' }),

    validationFlags: jsonb().notNull().default([]),
  },
  (t) => [
    uniqueIndex('receipts_receipt_number_per_fy_unique').on(t.financialYearStart, t.receiptNumber),
    uniqueIndex('receipts_razorpay_event_id_unique').on(t.razorpayEventId),
    uniqueIndex('receipts_gateway_payment_id_unique').on(t.gatewayPaymentId),
    index().on(t.clientId, t.receiptDate.desc()),
    index().on(t.bankAccountId),
    index().on(t.method),
    index().on(t.razorpayPaymentLinkId),
  ],
);

export type Receipt = typeof receipts.$inferSelect;
export type NewReceipt = typeof receipts.$inferInsert;
