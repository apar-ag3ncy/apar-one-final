import { index, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';

import { clientActivities } from './client_activities';
import { clientContacts } from './client_contacts';

/**
 * Multi-select attendees from contacts (P2.01 step 4: "Log activity dialog
 * with attendees (multi-select from contacts)").
 *
 * Composite PK keeps (activity, contact) unique. No soft-delete here — if the
 * activity is soft-deleted, the row stays; if the underlying contact or
 * activity is hard-deleted, this row cascades.
 */
export const clientActivityAttendees = pgTable(
  'client_activity_attendees',
  {
    activityId: uuid()
      .notNull()
      .references(() => clientActivities.id, { onDelete: 'cascade' }),
    contactId: uuid()
      .notNull()
      .references(() => clientContacts.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.activityId, t.contactId] }), index().on(t.contactId)],
);
