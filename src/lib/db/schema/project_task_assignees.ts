import { sql } from 'drizzle-orm';
import { index, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { employees } from './employees';
import { projectTasks } from './project_tasks';

/**
 * Deliverable assignment — many-to-many between deliverables
 * (`project_tasks`) and employees (0061). Replaces the single
 * `project_tasks.assigneeEmployeeId` (legacy column kept until a later
 * cleanup migration; backfilled in 0061). Assignments are added and removed,
 * never edited, so this carries ONLY `createdAt` + `createdBy` — mirroring
 * `project_members` (0054). Idempotent by UNIQUE(taskId, employeeId); both
 * FKs cascade on delete.
 */
export const projectTaskAssignees = pgTable(
  'project_task_assignees',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    taskId: uuid()
      .notNull()
      .references(() => projectTasks.id, { onDelete: 'cascade' }),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    createdBy: uuid(),
  },
  (t) => [
    unique('project_task_assignees_task_employee_uniq').on(t.taskId, t.employeeId),
    index().on(t.taskId),
    index().on(t.employeeId),
  ],
);

export type ProjectTaskAssignee = typeof projectTaskAssignees.$inferSelect;
export type NewProjectTaskAssignee = typeof projectTaskAssignees.$inferInsert;
