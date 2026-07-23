import { date, index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { deliverableCategories } from './deliverable_categories';
import { employees } from './employees';
import { projects } from './projects';

export const projectTaskStatusEnum = pgEnum('project_task_status', [
  'todo',
  'in_progress',
  'done',
  // Extra manual statuses (0075). 'done' is labelled "Completed" in the UI;
  // the delayed statuses are still OPEN (they don't stamp completedAt).
  'little_delayed',
  'delayed',
  'cancelled',
]);

/**
 * A lightweight per-project deliverable board (surfaced as "Deliverables" in
 * the OS; table name kept for continuity). Deliverables move through
 * todo → in_progress → done; `completedAt` is stamped by the server action
 * when one enters 'done' (and cleared when it leaves). Soft-delete via
 * `deletedAt` (from timestamps()). `position` orders rows within a
 * project/column.
 *
 * Assignment is many-to-many via `project_task_assignees` (0061).
 * `assigneeEmployeeId` is the LEGACY single-assignee column — backfilled into
 * the join table and no longer read or written; dropped in a later cleanup
 * migration once verified.
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
    /** Global deliverable category (0061). SET NULL on category delete. */
    categoryId: uuid().references(() => deliverableCategories.id, {
      onDelete: 'set null',
    }),
    /**
     * Eisenhower priority tag (0070): 'urgent_important' | 'urgent' |
     * 'important' | 'nice'. NULL = no priority. Plain text; values are
     * enforced by the zod enums in server/entities/project-tasks.ts.
     */
    priority: text(),
    /**
     * Where the deliverable came from (0070): 'apar' | 'vendor'. NULL on
     * legacy rows; the server action defaults new deliverables to 'apar'.
     */
    source: text(),
    dueOn: date(),
    position: integer().notNull().default(0),
    completedAt: timestamp({ withTimezone: true }),
    /**
     * How the task landed relative to its due date, stamped when it enters
     * 'done' (0085): 'on_time' | 'slightly_delayed' | 'delayed'. Auto-computed
     * from completedAt vs dueOn (a task with no dueOn counts as on_time); NULL
     * while the task is not completed. Cleared when the task leaves 'done'.
     */
    completionOutcome: text(),
  },
  (t) => [
    index().on(t.projectId),
    index().on(t.assigneeEmployeeId),
    index().on(t.status),
    index().on(t.categoryId),
  ],
);

export type ProjectTask = typeof projectTasks.$inferSelect;
export type NewProjectTask = typeof projectTasks.$inferInsert;
