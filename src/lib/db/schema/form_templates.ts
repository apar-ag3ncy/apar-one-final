import { boolean, index, integer, pgTable, text } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { entityTypeEnum } from './_polymorphic';

/**
 * Form Builder template (AUDIT-GAPS §2 — interpretation B = "typed
 * fields, reportable"). One active template per entity type at a time;
 * versions are append-only via `version + isActive`.
 *
 * Form templates layer ON TOP of the locked required columns on the
 * principal entity tables. They never own the principal columns
 * (`name`, `email`, `contract_status`, etc.) — those stay in code.
 *
 * The Form Builder's UI checks `manage_form_templates` capability.
 */
export const formTemplates = pgTable(
  'form_templates',
  {
    ...timestamps(),
    ...auditColumns(),
    entityType: entityTypeEnum().notNull(),
    name: text().notNull(),
    description: text(),
    version: integer().notNull().default(1),
    isActive: boolean().notNull().default(false),
    notes: text(),
  },
  (t) => [index().on(t.entityType, t.isActive), index().on(t.entityType, t.version)],
);

export type FormTemplate = typeof formTemplates.$inferSelect;
export type NewFormTemplate = typeof formTemplates.$inferInsert;
