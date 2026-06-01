import { index, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { timestamps } from './_ledger';
import { formFields } from './form_fields';
import { users } from './users';

export const formFieldChangeKindEnum = pgEnum('form_field_change_kind', [
  'created',
  'label_updated',
  'help_text_updated',
  'options_updated',
  'visibility_updated',
  'required_tightened',
  'required_relaxed',
  'order_updated',
  'deprecated',
  'restored',
]);

/**
 * Audit trail for form-field schema changes. Distinct from `audit_log`
 * because:
 *   - Form-field edits are conceptual schema changes that affect every
 *     entity carrying that field
 *   - The diff in `audit_log` is row-level; this one tracks intent
 *
 * Required-tightening backfill (AUDIT-GAPS §2.2 invariant 4) records
 * `required_tightened` plus the list of affected entities in `payload`
 * so admins can re-find rows that were left grandfathered.
 *
 * Append-only. Uses `_ledger.timestamps()` (no deleted_at).
 */
export const formFieldChanges = pgTable(
  'form_field_changes',
  {
    ...timestamps(),
    formFieldId: uuid()
      .notNull()
      .references(() => formFields.id, { onDelete: 'cascade' }),
    actorId: uuid().references(() => users.id, { onDelete: 'set null' }),
    kind: formFieldChangeKindEnum().notNull(),
    diff: jsonb().notNull().default({}),
    notes: text(),
  },
  (t) => [index().on(t.formFieldId, t.createdAt.desc()), index().on(t.kind)],
);

export type FormFieldChange = typeof formFieldChanges.$inferSelect;
export type NewFormFieldChange = typeof formFieldChanges.$inferInsert;
