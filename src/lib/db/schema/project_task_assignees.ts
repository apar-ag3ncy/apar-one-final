import { sql } from 'drizzle-orm';
import { index, pgTable, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { employees } from './employees';
import { projectTasks } from './project_tasks';
import { vendors } from './vendors';

/**
 * Deliverable assignment — many-to-many between deliverables
 * (`project_tasks`) and either an employee (0061) or a vendor (0073).
 * Replaces the single `project_tasks.assigneeEmployeeId` (legacy column kept
 * until a later cleanup migration; backfilled in 0061). Assignments are added
 * and removed, never edited, so this carries ONLY `createdAt` + `createdBy` —
 * mirroring `project_members` (0054).
 *
 * Exactly one of `employeeId` / `vendorId` is set (0073 CHECK
 * `num_nonnulls(...) = 1`). Employee links stay idempotent by
 * UNIQUE(taskId, employeeId); vendor links by the partial
 * UNIQUE(taskId, vendorId) WHERE vendor_id IS NOT NULL (SQL NULLs are distinct
 * in the plain unique, so vendor rows don't collide there). All FKs cascade on
 * delete.
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
    // Nullable since 0073 — a row points at either an employee or a vendor.
    employeeId: uuid().references(() => employees.id, { onDelete: 'cascade' }),
    vendorId: uuid().references(() => vendors.id, { onDelete: 'cascade' }),
    createdBy: uuid(),
  },
  (t) => [
    unique('project_task_assignees_task_employee_uniq').on(t.taskId, t.employeeId),
    uniqueIndex('project_task_assignees_task_vendor_uniq')
      .on(t.taskId, t.vendorId)
      .where(sql`${t.vendorId} IS NOT NULL`),
    index().on(t.taskId),
    index().on(t.employeeId),
    index().on(t.vendorId),
  ],
);

export type ProjectTaskAssignee = typeof projectTaskAssignees.$inferSelect;
export type NewProjectTaskAssignee = typeof projectTaskAssignees.$inferInsert;
