import { boolean, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { clients } from './clients';

/**
 * POC = Point of Contact (client-side person), per glossary in CLAUDE.md.
 * Not "Proof of Concept."
 */
export const clientContacts = pgTable(
  'client_contacts',
  {
    ...timestamps(),
    ...auditColumns(),
    clientId: uuid()
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    role: text(),
    email: text(),
    phone: text(),
    isPrimary: boolean().notNull().default(false),
    notes: text(),
  },
  (t) => [index().on(t.clientId), index().on(t.email)],
);
