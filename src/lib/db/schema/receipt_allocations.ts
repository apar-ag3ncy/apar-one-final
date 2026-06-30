import { bigint, index, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { transactions } from './transactions';

/**
 * Allocates a `client_payment_received` transaction to one or more
 * `client_invoice` transactions. The client-side mirror of `bill_allocations`
 * (vendor payments → bills). Outstanding-per-invoice + receivables-by-project
 * read this: outstanding = Σ(1200 debit on the invoice txn) − Σ allocations.
 *
 * The trigger `tg_receipt_allocation_sum_check_*` (migration 0049) enforces:
 *   SUM(amount_paise) over a client_payment_txn_id
 *     <= the client_payment_received transaction's total
 *        (= SUM of debit-side postings on that txn: bank/cash + TDS-receivable).
 *
 * Unlike bill_allocations, the table (and this schema) DO carry `deleted_at`
 * (via timestamps()) so they stay in sync — 0031 omitted it on bill_allocations
 * and Drizzle's emitted INSERT broke until 0047 reconciled the schema.
 */
export const receiptAllocations = pgTable(
  'receipt_allocations',
  {
    ...timestamps(),
    ...auditColumns(),
    clientPaymentTxnId: uuid()
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    clientInvoiceTxnId: uuid()
      .notNull()
      .references(() => transactions.id, { onDelete: 'restrict' }),
    amountPaise: bigint({ mode: 'bigint' }).notNull(),
  },
  (t) => [
    uniqueIndex('receipt_allocations_payment_invoice_unique').on(
      t.clientPaymentTxnId,
      t.clientInvoiceTxnId,
    ),
    index().on(t.clientPaymentTxnId),
    index().on(t.clientInvoiceTxnId),
  ],
);

export type ReceiptAllocation = typeof receiptAllocations.$inferSelect;
export type NewReceiptAllocation = typeof receiptAllocations.$inferInsert;
