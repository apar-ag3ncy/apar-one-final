import { bigint, index, integer, pgEnum, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { estimates } from './estimates';
import { invoices } from './invoices';

/**
 * Tracks the conversion of an estimate into one or more invoices. The
 * `kind` discriminates how the value applies:
 *
 *   - `full`            — invoice covers 100% of the estimate
 *   - `partial_pct`     — `valuePctBps` (basis points; 5000 = 50%) of estimate total
 *   - `partial_amount`  — `valuePaise` flat paise amount
 *   - `partial_lines`   — line-by-line conversion (caller resolves which lines;
 *                         this row records the resulting invoice total)
 *
 * When the sum of conversion values reaches the estimate's
 * `capturedTotalPaise`, the estimate state flips to `converted`. The
 * server action `convertEstimateToInvoice` (Phase 3) owns that
 * accounting.
 */
export const estimateLinkKindEnum = pgEnum('estimate_link_kind', [
  'full',
  'partial_pct',
  'partial_amount',
  'partial_lines',
]);

export const estimateInvoiceLinks = pgTable(
  'estimate_invoice_links',
  {
    ...timestamps(),
    ...auditColumns(),
    estimateId: uuid()
      .notNull()
      .references(() => estimates.id, { onDelete: 'restrict' }),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    kind: estimateLinkKindEnum().notNull(),
    valuePctBps: integer(), // for kind = 'partial_pct'
    valuePaise: bigint({ mode: 'bigint' }), // for kind = 'partial_amount' or recorded total
  },
  (t) => [
    uniqueIndex('estimate_invoice_links_pair_unique').on(t.estimateId, t.invoiceId),
    index().on(t.estimateId),
    index().on(t.invoiceId),
  ],
);

export type EstimateInvoiceLink = typeof estimateInvoiceLinks.$inferSelect;
export type NewEstimateInvoiceLink = typeof estimateInvoiceLinks.$inferInsert;
