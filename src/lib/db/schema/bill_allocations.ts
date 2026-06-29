import { sql } from 'drizzle-orm';
import { bigint, index, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { auditColumns } from './_shared';
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
 *
 * NOTE: unlike `payment_allocations`, this table has NO `deleted_at` column —
 * migration 0031 created it without one. So we must NOT spread `...timestamps()`
 * here (that mixin adds `deletedAt`, which makes Drizzle emit `deleted_at` in
 * every INSERT and fail with "column bill_allocations.deleted_at does not
 * exist"). Soft-delete isn't used for allocations; the ON DELETE CASCADE from
 * the payment txn handles removal of an unposted payment's allocations.
 */
export const billAllocations = pgTable(
  'bill_allocations',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
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
