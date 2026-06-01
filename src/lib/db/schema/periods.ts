import {
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_ledger';
import { users } from './users';

export const periodStatusEnum = pgEnum('period_status', ['open', 'soft_closed', 'closed']);

/**
 * Accounting periods. LEDGER-SPEC §1.3.
 *
 * v1 ships with `settings.enforce_period_close=false` (default), so
 * `period_id` gets auto-assigned to every transaction via a trigger but
 * posting into a closed period is allowed. Turning enforcement on is
 * one boolean and no schema change.
 *
 * Indian FY: `month` is 1..12 with month 1 = April. `fiscal_year`
 * follows the convention "FY = year of the March-ending boundary", so
 * FY 2026 = (April 2025 – March 2026).
 *
 * Re-open is partner-only, mandatory reason — gated by the
 * `reopen_period` capability + audit log row.
 */
export const periods = pgTable(
  'periods',
  {
    ...timestamps(),
    fiscalYear: integer().notNull(),
    month: integer().notNull(), // 1..12 where 1 = April
    startsOn: date().notNull(),
    endsOn: date().notNull(),
    status: periodStatusEnum().notNull().default('open'),
    closedAt: timestamp({ withTimezone: true }),
    closedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    reopenedAt: timestamp({ withTimezone: true }),
    reopenedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    reopenReason: text(),
  },
  (t) => [uniqueIndex('periods_fiscal_year_month_unique').on(t.fiscalYear, t.month)],
);

export type Period = typeof periods.$inferSelect;
export type NewPeriod = typeof periods.$inferInsert;
