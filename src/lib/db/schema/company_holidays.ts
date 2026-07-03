import { sql } from 'drizzle-orm';
import { date, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';

/**
 * Company holiday calendar. One row per non-working public/company holiday.
 * Consumed by payroll to compute a month's *working days* (calendar days minus
 * Sundays minus these holidays) when prorating salary by attendance, and by the
 * attendance grid as context. HR-managed via Settings → Holidays.
 *
 * One holiday per date (unique), so the working-day count can't be
 * double-decremented. Soft-deletable via `deletedAt` like every business table.
 */
export const companyHolidays = pgTable(
  'company_holidays',
  {
    ...timestamps(),
    ...auditColumns(),
    holidayDate: date().notNull(),
    name: text().notNull(),
  },
  // Partial unique: one *active* holiday per date, but a soft-deleted date can
  // be re-added later.
  (t) => [
    uniqueIndex('company_holidays_date_unique')
      .on(t.holidayDate)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export type CompanyHoliday = typeof companyHolidays.$inferSelect;
export type NewCompanyHoliday = typeof companyHolidays.$inferInsert;
