import { bigint, index, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { invoices } from './invoices';
import { receipts } from './receipts';

/**
 * Allocates a receipt to one or more invoices. The trigger
 * `tg_payment_allocation_sum_check` (defined in 0019) enforces:
 *
 *   SUM(allocated_paise) over all allocations for a receipt
 *     <= receipts.totalPaise
 *
 * Server actions (Phase 4.5) call `allocateReceipt(receipt_id,
 * allocations[])` and default to FIFO if no explicit allocation is
 * supplied (oldest unpaid invoice first).
 *
 * Cascading delete on `receiptId` is allowed only while the receipt is
 * unposted (no `postedTransactionId`); the posted-transaction
 * immutability discipline + the no-delete trigger on `receipts`
 * (added in 0019) enforce that.
 */
export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    ...timestamps(),
    ...auditColumns(),
    receiptId: uuid()
      .notNull()
      .references(() => receipts.id, { onDelete: 'cascade' }),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    allocatedPaise: bigint({ mode: 'bigint' }).notNull(),
  },
  (t) => [
    uniqueIndex('payment_allocations_receipt_invoice_unique').on(t.receiptId, t.invoiceId),
    index().on(t.receiptId),
    index().on(t.invoiceId),
  ],
);

export type PaymentAllocation = typeof paymentAllocations.$inferSelect;
export type NewPaymentAllocation = typeof paymentAllocations.$inferInsert;
