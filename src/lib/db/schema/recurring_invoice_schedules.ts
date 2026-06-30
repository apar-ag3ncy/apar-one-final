import {
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { clients } from './clients';
import { projects } from './projects';
import { invoices } from './invoices';

export const recurringCadenceEnum = pgEnum('recurring_cadence', [
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
]);

/**
 * The captured invoice template stored on a recurring schedule — everything
 * `createDraftInvoice` needs except the per-run document date / due date /
 * number / idempotency key. Amounts are strings (jsonb can't hold bigint);
 * the generator parses them back to bigint paise.
 */
export type RecurringTemplate = {
  documentType: 'invoice' | 'proforma';
  billToAddressId: string | null;
  placeOfSupply: string | null;
  themeId: string | null;
  bankAccountId: string | null;
  terms: string | null;
  notes: string | null;
  subtotalPaise: string;
  capturedTaxTotalPaise: string;
  capturedTotalPaise: string;
  capturedTaxSplit: {
    cgst_paise: string;
    sgst_paise: string;
    igst_paise: string;
    cess_paise: string;
  };
  lines: Array<{
    description: string;
    sacCode: string | null;
    qty: number;
    ratePaise: string;
    capturedTaxableValuePaise: string;
    capturedTaxRateBps: number;
    capturedTaxAmountPaise: string;
  }>;
};

/**
 * Recurring invoice / retainer schedules. See drizzle/0050_recurring_invoices.sql.
 */
export const recurringInvoiceSchedules = pgTable('recurring_invoice_schedules', {
  ...timestamps(),
  ...auditColumns(),
  clientId: uuid()
    .notNull()
    .references(() => clients.id, { onDelete: 'restrict' }),
  projectId: uuid().references(() => projects.id, { onDelete: 'set null' }),
  name: text().notNull(),
  cadence: recurringCadenceEnum().notNull(),
  intervalCount: integer().notNull().default(1),
  nextRunDate: date().notNull(),
  endDate: date(),
  dueDays: integer().notNull().default(0),
  template: jsonb().$type<RecurringTemplate>().notNull(),
  isActive: boolean().notNull().default(true),
  lastGeneratedAt: timestamp({ withTimezone: true }),
  lastInvoiceId: uuid().references(() => invoices.id, { onDelete: 'set null' }),
  notes: text(),
});

export type RecurringInvoiceSchedule = typeof recurringInvoiceSchedules.$inferSelect;
export type NewRecurringInvoiceSchedule = typeof recurringInvoiceSchedules.$inferInsert;
