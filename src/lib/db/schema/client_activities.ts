import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { clientContacts } from './client_contacts';
import { clients } from './clients';
import { users } from './users';

export const clientActivityTypeEnum = pgEnum('client_activity_type', [
  'meeting',
  'email',
  'call',
  'note',
]);

/**
 * P2.01 — chronological feed of meetings / emails / calls / notes against a
 * client. The primary contact for the interaction goes in `contactId`; the
 * full attendee list lives in `client_activity_attendees`.
 *
 * Attachments live in `client_activity_attachments` (join to `documents`).
 *
 * Soft delete via `deletedAt` per CLAUDE.md rule #36.
 */
export const clientActivities = pgTable(
  'client_activities',
  {
    ...timestamps(),
    ...auditColumns(),
    clientId: uuid()
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    // Primary contact for the interaction, optional (e.g. internal-only notes).
    contactId: uuid().references(() => clientContacts.id, { onDelete: 'set null' }),
    type: clientActivityTypeEnum().notNull(),
    summary: text().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    followUpAt: timestamp({ withTimezone: true }),
    // Who logged this activity. FK to users, SET NULL if that user leaves.
    recordedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    // (clientId, occurredAt DESC) is the dominant query — the activity feed.
    index().on(t.clientId, t.occurredAt.desc()),
    index().on(t.type),
    index().on(t.followUpAt),
  ],
);
