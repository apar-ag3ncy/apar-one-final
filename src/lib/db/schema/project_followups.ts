import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { projects } from './projects';

/**
 * Follow-up thread on a PROJECT (0077, §4.2). Mirrors project_task_followups
 * (0076) but keyed to the project itself. Two sources feed it:
 *   • `kind = 'priority_change'` — auto-appended by updateProject when a
 *     project's priority changes (records that the POC should be followed up);
 *   • `kind = 'note'` — a manually-added follow-up from the project window.
 * The ordered list of rows for a project IS the thread. Notes are added, never
 * edited. FK cascades so deleting a project drops its thread.
 */
export const projectFollowups = pgTable(
  'project_followups',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    note: text().notNull(),
    kind: text().notNull().default('note'),
    createdBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.projectId)],
);

export type ProjectFollowup = typeof projectFollowups.$inferSelect;
export type NewProjectFollowup = typeof projectFollowups.$inferInsert;
