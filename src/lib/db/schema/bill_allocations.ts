import { bigint, index, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { transactions } from './transactions';

/**
 * Allocates a `vendor_payment_made` transaction to one or more
 * `vendor_bill` transactions. Symmetric to payment_allocations
 * (receipts → invoices) on the customer side.
 *
 * The trigger `tg_bill_allocation_sum_check_*` (defined in 0031)
 * enforces:
 *   SUM(amount_paise) over a vendor_payment_txn_id
 *     <= the vendor_payment_made transaction's total
 *        (derived as SUM of debit-side postings on that txn).
 *
 * Server actions live at `src/lib/server/billing/bill-allocations.ts`.
 * The vendor payment posting template already accepts a
 * `billAllocations` field in its input schema; phase 4 wires that
 * through to writes here.
 */
export const billAllocations = pgTable(
  'bill_allocations',
  {
    ...timestamps(),
    ...auditColumns(),
    vendorPaymentTxnId: uuid()
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    billTxnId: uuid()
      .notNull()
      .references(() => transactions.id, { onDelete: 'restrict' }),
    amountPaise: bigint({ mode: 'bigint' }).notNull(),
  },
  (t) => [
    uniqueIndex('bill_allocations_payment_bill_unique').on(t.vendorPaymentTxnId, t.billTxnId),
    index().on(t.vendorPaymentTxnId),
    index().on(t.billTxnId),
  ],
);

export type BillAllocation = typeof billAllocations.$inferSelect;
export type NewBillAllocation = typeof billAllocations.$inferInsert;
