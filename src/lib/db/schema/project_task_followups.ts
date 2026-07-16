import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { projectTasks } from './project_tasks';

/**
 * Follow-up thread on a deliverable (0076). For any task — typically one handed
 * to a vendor — this records follow-ups as notes and keeps the complete history
 * thread: the ordered list of rows for a task IS the thread. Notes are added,
 * never edited, so this carries ONLY `createdAt` + `createdBy`, mirroring
 * `project_task_assignees` (0073). The FK cascades so deleting a task drops its
 * thread.
 */
export const projectTaskFollowups = pgTable(
  'project_task_followups',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    taskId: uuid()
      .notNull()
      .references(() => projectTasks.id, { onDelete: 'cascade' }),
    note: text().notNull(),
    createdBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.taskId)],
);

export type ProjectTaskFollowup = typeof projectTaskFollowups.$inferSelect;
export type NewProjectTaskFollowup = typeof projectTaskFollowups.$inferInsert;
