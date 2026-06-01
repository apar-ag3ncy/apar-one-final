import { bigint, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { estimates } from './estimates';
import { serviceItems } from './service_items';

/**
 * Estimate line items — mirror of `invoice_lines`. See `invoice_lines.ts`
 * for the captured-not-computed comment.
 */
export const estimateLines = pgTable(
  'estimate_lines',
  {
    ...timestamps(),
    ...auditColumns(),
    estimateId: uuid()
      .notNull()
      .references(() => estimates.id, { onDelete: 'cascade' }),
    lineNo: integer().notNull(),
    serviceItemId: uuid().references(() => serviceItems.id, { onDelete: 'set null' }),
    description: text().notNull(),
    sacCode: text(),

    qty: integer().notNull().default(1),
    ratePaise: bigint({ mode: 'bigint' }).notNull().default(0n),

    capturedTaxableValuePaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    capturedTaxRateBps: integer().notNull().default(0),
    capturedTaxAmountPaise: bigint({ mode: 'bigint' }).notNull().default(0n),

    postingAccountCode: text().notNull().default('4100'),
  },
  (t) => [
    uniqueIndex('estimate_lines_estimate_line_no_unique').on(t.estimateId, t.lineNo),
    index().on(t.estimateId),
    index().on(t.serviceItemId),
  ],
);

export type EstimateLine = typeof estimateLines.$inferSelect;
export type NewEstimateLine = typeof estimateLines.$inferInsert;
