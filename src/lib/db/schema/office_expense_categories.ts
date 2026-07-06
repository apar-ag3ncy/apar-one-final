import { index, pgTable, text } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';

/**
 * User-defined custom office-expense categories. These sit alongside the
 * fixed `office_expense_category` enum: when an expense is filed under
 * category='other', the OS Office app can pin it to one of these rows via
 * `officeExpenses.customCategoryId`. Case-insensitive uniqueness among
 * active (deletedAt null) rows is enforced by a partial unique index in
 * the migration.
 */
export const officeExpenseCategories = pgTable(
  'office_expense_categories',
  {
    ...timestamps(),
    ...auditColumns(),
    /** Display name shown in the picker. Trimmed + deduped on create. */
    name: text().notNull(),
    /** Optional swatch (hex or token) for the OS chip. */
    color: text(),
    /** Optional one-line hint describing what belongs in this bucket. */
    hint: text(),
  },
  (t) => [index().on(t.name)],
);

export type OfficeExpenseCategory = typeof officeExpenseCategories.$inferSelect;
export type NewOfficeExpenseCategory = typeof officeExpenseCategories.$inferInsert;
