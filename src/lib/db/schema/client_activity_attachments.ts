import { index, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';

import { clientActivities } from './client_activities';
import { documents } from './documents';

/**
 * Files attached to a client activity (P2.01 step 1: "attachments[]").
 *
 * The actual file lives in Supabase Storage; this row joins the activity to
 * the existing `documents` row. Documents service is responsible for setting
 * `documents.entityType='client_activity'` + `entityId=activityId` when the
 * file is uploaded in the activity flow.
 */
export const clientActivityAttachments = pgTable(
  'client_activity_attachments',
  {
    activityId: uuid()
      .notNull()
      .references(() => clientActivities.id, { onDelete: 'cascade' }),
    documentId: uuid()
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.activityId, t.documentId] }), index().on(t.documentId)],
);
