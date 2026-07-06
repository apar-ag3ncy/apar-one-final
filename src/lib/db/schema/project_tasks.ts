import {
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { employees } from './employees';
import { projects } from './projects';

export const projectTaskStatusEnum = pgEnum('project_task_status', [
  'todo',
  'in_progress',
  'done',
]);

/**
 * A lightweight per-project task board. Tasks move through
 * todo → in_progress → done; `completedAt` is stamped by the server action
 * when a task enters 'done' (and cleared when it leaves). Soft-delete via
 * `deletedAt` (from timestamps()). `assigneeEmployeeId` points the task at a
 * team member (nullable; SET NULL when the employee is deleted). `position`
 * orders tasks within a project/column.
 */
export const projectTasks = pgTable(
  'project_tasks',
  {
    ...timestamps(),
    ...auditColumns(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    description: text(),
    status: projectTaskStatusEnum().notNull().default('todo'),
    assigneeEmployeeId: uuid().references(() => employees.id, {
      onDelete: 'set null',
    }),
    dueOn: date(),
    position: integer().notNull().default(0),
    completedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index().on(t.projectId),
    index().on(t.assigneeEmployeeId),
    index().on(t.status),
  ],
);

export type ProjectTask = typeof projectTasks.$inferSelect;
export type NewProjectTask = typeof projectTasks.$inferInsert;
