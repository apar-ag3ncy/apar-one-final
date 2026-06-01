import { boolean, check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { auditColumns, timestamps } from './_shared';
import { entityTypeEnum } from './_polymorphic';

/**
 * Polymorphic POCs (Point of Contact). Replaces `client_contacts` —
 * a compat view `client_contacts` is preserved in
 * `0003_entity_subgraph.sql` so the frontend (which currently reads
 * `client_contacts`) keeps working until B finishes the swap.
 *
 * **SPEC-AMENDMENT-001 §1.** POCs require at least one of email OR
 * phone — CHECK constraint here, RHF validation on the form. Server
 * actions Zod-refine the same condition before insert.
 *
 * The polymorphic-CHECK trigger (`0003_polymorphic_check.sql`) verifies
 * that `(entity_type, entity_id)` resolves to a real row in the matching
 * principal table.
 */
export const entityContacts = pgTable(
  'entity_contacts',
  {
    ...timestamps(),
    ...auditColumns(),
    entityType: entityTypeEnum().notNull(),
    entityId: uuid().notNull(),
    name: text().notNull(),
    role: text(), // 'CFO', 'Procurement', 'Emergency Contact' — freeform label
    email: text(),
    phone: text(),
    isPrimary: boolean().notNull().default(false),
    notes: text(),
  },
  (t) => [
    index().on(t.entityType, t.entityId),
    index().on(t.email),
    index().on(t.phone),
    // SPEC-AMENDMENT-001 §1: at least one of email/phone required
    check('entity_contacts_email_or_phone', sql`${t.email} IS NOT NULL OR ${t.phone} IS NOT NULL`),
  ],
);

export type EntityContact = typeof entityContacts.$inferSelect;
export type NewEntityContact = typeof entityContacts.$inferInsert;
