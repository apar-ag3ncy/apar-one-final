import { bigint, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { clients } from './clients';
import { receipts } from './receipts';

/**
 * Customer advances received before any invoice is raised. Under
 * GST Rule 50, every advance generates a Receipt Voucher (see
 * `receipt_vouchers.ts`) and triggers an Output-GST liability that
 * gets parked in `1252 Advance-Output-GST-Asset` until the invoice
 * is later raised and the liability is unwound (Phase 4.7).
 *
 *   - `originalReceiptId` — the inbound payment that created the advance
 *   - `receiptVoucherId`  — the Rule 50 voucher we generate in response
 *   - `advancePaise`      — net advance amount
 *   - `advanceTaxPaise`   — captured (NOT computed) advance-tax portion
 *   - `balancePaise`      — derived (advancePaise - SUM of advance_allocations.allocatedPaise);
 *                           materialized for fast list queries, kept in sync by
 *                           `tg_advance_balance_refresh` defined in 0019.
 *
 * Once `balancePaise == 0` the advance is fully adjusted. Refunds flow
 * through `refund_vouchers` and reverse the Rule 50 posting.
 */
export const customerAdvances = pgTable(
  'customer_advances',
  {
    ...timestamps(),
    ...auditColumns(),
    clientId: uuid()
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    originalReceiptId: uuid()
      .notNull()
      .references(() => receipts.id, { onDelete: 'restrict' }),
    receiptVoucherId: uuid().notNull(), // FK declared in 0019 (receipt_vouchers FK; circular import otherwise)

    advancePaise: bigint({ mode: 'bigint' }).notNull(),
    advanceTaxPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    advanceTaxRateBps: integer().notNull().default(1800),

    balancePaise: bigint({ mode: 'bigint' }).notNull(), // refreshed by trigger

    notes: text(),
  },
  (t) => [
    uniqueIndex('customer_advances_receipt_voucher_unique').on(t.receiptVoucherId),
    index().on(t.clientId),
    index().on(t.originalReceiptId),
    index().on(t.balancePaise), // partial-index-friendly: WHERE balance_paise > 0
  ],
);

export type CustomerAdvance = typeof customerAdvances.$inferSelect;
export type NewCustomerAdvance = typeof customerAdvances.$inferInsert;
