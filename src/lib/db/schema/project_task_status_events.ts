import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { employees } from './employees';
import { projectTasks } from './project_tasks';

/**
 * Append-only status-change log for a deliverable (project_tasks) — 0085.
 * Every time a task moves between statuses (by an employee in their workspace
 * or by an admin in the project window) one row is written here. The ordered
 * rows for a task ARE its status history; nothing is edited or deleted, so the
 * table carries only creation metadata (mirrors project_task_followups, 0076).
 *
 * The actor is recorded WITHOUT touching the text/uuid trap: employee changes
 * store `actor_employee_id` (a real employees.id uuid) + a denormalized
 * `actor_label`; admin changes store `actor_kind='admin'` with a null employee
 * id (os_users ids are text and can't go in a uuid FK). The FK cascades so
 * deleting a task drops its history.
 */
export const projectTaskStatusEvents = pgTable(
  'project_task_status_events',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    taskId: uuid()
      .notNull()
      .references(() => projectTasks.id, { onDelete: 'cascade' }),
    // Null only for the seed/creation event (there was no prior status).
    fromStatus: text(),
    toStatus: text().notNull(),
    // 'employee' | 'admin' | 'system'
    actorKind: text().notNull(),
    // Set for employee-driven changes; null for admin/system.
    actorEmployeeId: uuid().references(() => employees.id, { onDelete: 'set null' }),
    // Denormalized display name captured at write time (survives renames/deletes).
    actorLabel: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.taskId), index().on(t.actorEmployeeId)],
);

export type ProjectTaskStatusEvent = typeof projectTaskStatusEvents.$inferSelect;
export type NewProjectTaskStatusEvent = typeof projectTaskStatusEvents.$inferInsert;
