import { index, jsonb, pgTable, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { entityTypeEnum } from './_polymorphic';
import { formFields } from './form_fields';

/**
 * One row per (entity, form_field) pairing carrying the user-entered
 * value. `value` is jsonb so a date is a date, a multiselect is an
 * array, a file is `{document_id, signed}`, etc.
 *
 * AUDIT-GAPS §2.2 invariants enforced at the application layer (the
 * server actions check field.type against value.type before insert).
 *
 * UNIQUE (entity_type, entity_id, form_field_id) is enforced via a
 * unique index in the migration — Drizzle's `unique()` builder is on
 * column constraints, not composite, so it gets attached in SQL.
 */
export const entityCustomValues = pgTable(
  'entity_custom_values',
  {
    ...timestamps(),
    ...auditColumns(),
    entityType: entityTypeEnum().notNull(),
    entityId: uuid().notNull(),
    formFieldId: uuid()
      .notNull()
      .references(() => formFields.id, { onDelete: 'cascade' }),
    value: jsonb().notNull(),
  },
  (t) => [index().on(t.entityType, t.entityId), index().on(t.formFieldId)],
);

export type EntityCustomValue = typeof entityCustomValues.$inferSelect;
export type NewEntityCustomValue = typeof entityCustomValues.$inferInsert;
