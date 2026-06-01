import { bigint, index, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { customerAdvances } from './customer_advances';
import { invoices } from './invoices';

/**
 * Adjusts a customer advance against a subsequent invoice. Each
 * allocation triggers an unwind posting (Phase 4.7):
 *
 *   Dr  2180 Client Advances Received (sub: client)   allocatedPaise
 *      Cr  1200 Trade Receivables    (sub: client)        allocatedPaise
 *   Dr  2120 GST Output Payable                        proportional_tax
 *      Cr  1252 Advance-Output-GST-Asset                  proportional_tax
 *
 * `tg_advance_alloc_sum_check` (defined in 0019) enforces:
 *   SUM(allocatedPaise) per advance <= customer_advances.advancePaise
 */
export const advanceAllocations = pgTable(
  'advance_allocations',
  {
    ...timestamps(),
    ...auditColumns(),
    advanceId: uuid()
      .notNull()
      .references(() => customerAdvances.id, { onDelete: 'restrict' }),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    allocatedPaise: bigint({ mode: 'bigint' }).notNull(),
  },
  (t) => [
    uniqueIndex('advance_allocations_advance_invoice_unique').on(t.advanceId, t.invoiceId),
    index().on(t.advanceId),
    index().on(t.invoiceId),
  ],
);

export type AdvanceAllocation = typeof advanceAllocations.$inferSelect;
export type NewAdvanceAllocation = typeof advanceAllocations.$inferInsert;
