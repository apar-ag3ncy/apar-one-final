import { pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';

/**
 * First-class department registry for the Employees module.
 *
 * Historically a department was just free text on `employees.department`
 * (lowercased). This table promotes departments to a managed entity so HR can
 * add, rename, and remove them from a proper UI. `employees.department` stays
 * the link (the canonical lowercased name); rename bulk-updates the matching
 * employee rows so the two never drift.
 *
 * `name` is the canonical lowercased form (e.g. 'people ops'); the UI renders
 * it title-cased via `departmentLabel`.
 */
export const departments = pgTable(
  'departments',
  {
    ...timestamps(),
    ...auditColumns(),
    name: text().notNull(),
  },
  (t) => [uniqueIndex('departments_name_unique').on(t.name)],
);

export type Department = typeof departments.$inferSelect;
export type NewDepartment = typeof departments.$inferInsert;
