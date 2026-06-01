import { bigint, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { bills } from './bills';

/**
 * Vendor bill line items. Same captured-not-computed shape as
 * `invoice_lines`. `postingAccountCode` defaults differ by
 * attribution — the server action sets `5100` for `client`-attributed
 * bills, the chosen `6xxx` for `opex`, `1510` for `asset`.
 */
export const billLines = pgTable(
  'bill_lines',
  {
    ...timestamps(),
    ...auditColumns(),
    billId: uuid()
      .notNull()
      .references(() => bills.id, { onDelete: 'cascade' }),
    lineNo: integer().notNull(),
    description: text().notNull(),
    sacCode: text(), // SAC for services, HSN for goods — same column

    qty: integer().notNull().default(1),
    ratePaise: bigint({ mode: 'bigint' }).notNull().default(0n),

    capturedTaxableValuePaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    capturedTaxRateBps: integer().notNull().default(0),
    capturedTaxAmountPaise: bigint({ mode: 'bigint' }).notNull().default(0n),

    postingAccountCode: text().notNull(), // no default; server action sets per attribution
  },
  (t) => [
    uniqueIndex('bill_lines_bill_line_no_unique').on(t.billId, t.lineNo),
    index().on(t.billId),
  ],
);

export type BillLine = typeof billLines.$inferSelect;
export type NewBillLine = typeof billLines.$inferInsert;
