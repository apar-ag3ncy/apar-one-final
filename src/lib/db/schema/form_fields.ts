import { boolean, index, integer, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { formTemplates } from './form_templates';

export const formFieldTypeEnum = pgEnum('form_field_type', [
  'text',
  'longtext',
  'number',
  'date',
  'datetime',
  'currency',
  'select',
  'multiselect',
  'file',
  'gstin',
  'pan',
  'phone',
  'email',
  'url',
  'boolean',
  'address',
  'relation', // FK to another entity_type
]);

/**
 * One field on a `form_template`. AUDIT-GAPS §2.2 invariants:
 *
 *   - `key` is immutable once data exists for the field. Rename label
 *     freely; deleting soft-deletes and preserves data.
 *   - `type` is immutable once data exists. The UI offers "deprecate
 *     and create new" instead of type-change.
 *   - Required can be TIGHTENED (optional → required) only via a
 *     backfill flow that lists entities missing the value.
 *
 * The migration adds CHECK constraints + a deferred trigger that
 * enforces immutability against `entity_custom_values`.
 *
 * SPEC-AMENDMENT-001 §6 — column-picker integration:
 *   - `isTableColumn` makes this field eligible for the column picker
 *     on the entity's list view.
 *   - `defaultTableVisible` controls initial visibility; user can hide.
 */
export const formFields = pgTable(
  'form_fields',
  {
    ...timestamps(),
    ...auditColumns(),
    formTemplateId: uuid()
      .notNull()
      .references(() => formTemplates.id, { onDelete: 'cascade' }),

    key: text().notNull(), // snake_case, immutable
    label: text().notNull(),
    helpText: text(),
    type: formFieldTypeEnum().notNull(),

    isRequired: boolean().notNull().default(false),
    isUnique: boolean().notNull().default(false),
    defaultValue: jsonb(),
    options: jsonb(), // for select / multiselect; or {min,max,regex} for text

    visibilityRoles: text().array(), // roles that can see/edit — null = all
    orderIndex: integer().notNull().default(0),

    // SPEC-AMENDMENT-001 §6.3 — column picker
    isTableColumn: boolean().notNull().default(false),
    defaultTableVisible: boolean().notNull().default(false),

    // Search (CLAUDE rule #20+, Cmd+K)
    isSearchable: boolean().notNull().default(false),
  },
  (t) => [index().on(t.formTemplateId, t.orderIndex), index().on(t.formTemplateId, t.key)],
);

export type FormField = typeof formFields.$inferSelect;
export type NewFormField = typeof formFields.$inferInsert;
