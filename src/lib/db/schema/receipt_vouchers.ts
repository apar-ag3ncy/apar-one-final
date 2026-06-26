import {
  bigint,
  char,
  date,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { clients } from './clients';
import { documents } from './documents';

/**
 * GST Rule 50 — Receipt Voucher. A statutory document Apar must issue
 * the moment we receive an advance against future services. Carries:
 *
 *   - voucher_number  unique-per-fy
 *   - party (client)
 *   - advance amount (paise)
 *   - tax amount (paise; captured, not computed)
 *   - tax rate (basis points; for display only)
 *   - place_of_supply (2-digit state code)
 *   - SAC (the planned service category)
 *
 * Generated PDF (lib/server/billing/pdf/receipt-voucher.ts, Phase 4)
 * stored via `sourceDocumentId`. The corresponding inbound receipt
 * row is referenced from `customer_advances.originalReceiptId`.
 *
 * Numbering is sequential per FY, distinct from invoice numbering
 * (CBIC requires distinct series per document type — e.g. 'RV/2025-26/0001').
 */
export const receiptVouchers = pgTable(
  'receipt_vouchers',
  {
    ...timestamps(),
    ...auditColumns(),
    voucherNumber: text().notNull(),
    voucherDate: date().notNull(),
    financialYearStart: date().notNull(),
    clientId: uuid()
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),

    advancePaise: bigint({ mode: 'bigint' }).notNull(),
    taxPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    taxRateBps: integer().notNull().default(1800),
    placeOfSupply: char({ length: 2 }),
    sacCode: text(),

    notes: text(),

    sourceDocumentId: uuid().references(() => documents.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('receipt_vouchers_voucher_number_per_fy_unique').on(
      t.financialYearStart,
      t.voucherNumber,
    ),
    index().on(t.clientId, t.voucherDate.desc()),
  ],
);

export type ReceiptVoucher = typeof receiptVouchers.$inferSelect;
export type NewReceiptVoucher = typeof receiptVouchers.$inferInsert;
