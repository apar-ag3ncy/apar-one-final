import { sql } from 'drizzle-orm';
import { integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';

/**
 * GLOBAL deliverable categories (0061) — user-defined buckets that apply to
 * deliverables (`project_tasks`) across ALL projects. Managed from the
 * Deliverables tab's "Manage categories" modal. Soft-delete via `deletedAt`;
 * names are unique case-insensitively among live rows (mirrors
 * `office_expense_categories`, 0053). `position` orders the picker.
 */
export const deliverableCategories = pgTable(
  'deliverable_categories',
  {
    ...timestamps(),
    ...auditColumns(),
    name: text().notNull(),
    /** Optional hex swatch for the UI chip. */
    color: text(),
    position: integer().notNull().default(0),
  },
  (t) => [
    uniqueIndex('deliverable_categories_name_lower_uniq')
      .on(sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type DeliverableCategory = typeof deliverableCategories.$inferSelect;
export type NewDeliverableCategory = typeof deliverableCategories.$inferInsert;
