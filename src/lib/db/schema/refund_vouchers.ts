import { bigint, date, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { documents } from './documents';
import { receiptVouchers } from './receipt_vouchers';

/**
 * GST Rule 51 — Refund Voucher. Issued when an advance is refunded
 * before any taxable supply is made against it. Reverses the Rule 50
 * posting:
 *
 *   Dr  2180 Client Advances Received (sub: client)   refundPaise
 *   Dr  2120 GST Output Payable                        taxRefundPaise
 *      Cr  1120 Bank Accounts (sub: bank)                 refundPaise + taxRefundPaise
 *      Cr  1252 Advance-Output-GST-Asset                  taxRefundPaise
 *
 * `originalReceiptVoucherId` is mandatory — every refund voucher
 * references the receipt voucher being unwound.
 */
export const refundVouchers = pgTable(
  'refund_vouchers',
  {
    ...timestamps(),
    ...auditColumns(),
    voucherNumber: text().notNull(),
    voucherDate: date().notNull(),
    financialYearStart: date().notNull(),
    originalReceiptVoucherId: uuid()
      .notNull()
      .references(() => receiptVouchers.id, { onDelete: 'restrict' }),

    refundPaise: bigint({ mode: 'bigint' }).notNull(),
    taxRefundPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    reason: text().notNull(),

    sourceDocumentId: uuid().references(() => documents.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('refund_vouchers_voucher_number_per_fy_unique').on(
      t.financialYearStart,
      t.voucherNumber,
    ),
    index().on(t.originalReceiptVoucherId),
  ],
);

export type RefundVoucher = typeof refundVouchers.$inferSelect;
export type NewRefundVoucher = typeof refundVouchers.$inferInsert;
