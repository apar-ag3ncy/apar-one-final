import { bigint, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { invoices } from './invoices';
import { serviceItems } from './service_items';

/**
 * Invoice line items. Quantity is `integer` — Apar invoices in whole
 * units (hours, days, deliverables, retainers). If fractional qty ever
 * comes up, ADD a new column rather than switching `qty` to numeric:
 * `numeric` is banned by `npm run db:check` because it would let money
 * sneak in.
 *
 * Rate is `bigint paise`. Captured taxable value / tax rate / tax amount
 * are USER-ENTERED (captured-not-computed). The validation rule
 * `invoice_line_arithmetic_mismatch` (warn) compares
 * `qty * ratePaise` vs `capturedTaxableValuePaise` and warns if off.
 */
export const invoiceLines = pgTable(
  'invoice_lines',
  {
    ...timestamps(),
    ...auditColumns(),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    lineNo: integer().notNull(),
    serviceItemId: uuid().references(() => serviceItems.id, { onDelete: 'set null' }),
    description: text().notNull(),
    sacCode: text(), // optional; if linked serviceItem this is denormalized at line time

    qty: integer().notNull().default(1),
    ratePaise: bigint({ mode: 'bigint' }).notNull().default(0n),

    // USER-ENTERED captured values. No computation.
    capturedTaxableValuePaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    capturedTaxRateBps: integer().notNull().default(0), // basis points: 1800 = 18%
    capturedTaxAmountPaise: bigint({ mode: 'bigint' }).notNull().default(0n),

    postingAccountCode: text().notNull().default('4100'), // overridable per line
  },
  (t) => [
    uniqueIndex('invoice_lines_invoice_line_no_unique').on(t.invoiceId, t.lineNo),
    index().on(t.invoiceId),
    index().on(t.serviceItemId),
  ],
);

export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type NewInvoiceLine = typeof invoiceLines.$inferInsert;
