import { bigint, date, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Read-only materialized views. Not migrations-managed by Drizzle
 * (created in 0026_billing_views.sql); the schema is declared here so
 * the type system + drizzle-orm's select API can talk to them.
 *
 * Do NOT INSERT / UPDATE / DELETE against these — they're refreshed
 * by `refresh_billing_views()` on a 5-minute cadence (Phase 9 wires
 * the cron) plus on-demand via the dashboard.
 */

export const arAging = pgTable('ar_aging', {
  invoiceId: uuid().primaryKey(),
  partyEntityId: uuid().notNull(),
  documentNumber: text().notNull(),
  documentDate: date().notNull(),
  dueDate: date(),
  invoiceTotalPaise: bigint({ mode: 'bigint' }).notNull(),
  paymentAllocatedPaise: bigint({ mode: 'bigint' }).notNull(),
  advanceAllocatedPaise: bigint({ mode: 'bigint' }).notNull(),
  creditNotedPaise: bigint({ mode: 'bigint' }).notNull(),
  outstandingPaise: bigint({ mode: 'bigint' }).notNull(),
  daysOverdueByDue: integer().notNull(),
  daysOverdueByInvoice: integer().notNull(),
  bucketByDue: text().notNull(),
  bucketByInvoice: text().notNull(),
});

export type ArAgingRow = typeof arAging.$inferSelect;

export const billingKpis = pgTable('billing_kpis', {
  totalOutstandingPaise: bigint({ mode: 'bigint' }).notNull(),
  oldestInvoiceDays: integer().notNull(),
  /** Percentage of outstanding sitting in the 90+ bucket, in basis points (5000 = 50%). */
  pctIn90PlusBps: integer().notNull(),
  thisMonthInvoicedPaise: bigint({ mode: 'bigint' }).notNull(),
  thisMonthReceivedPaise: bigint({ mode: 'bigint' }).notNull(),
  /** Avg days from invoice date to paid state, last 90 days (integer days). */
  avgDaysToPay90d: integer().notNull(),
  computedAt: timestamp({ withTimezone: true }).notNull(),
});

export type BillingKpisRow = typeof billingKpis.$inferSelect;
