import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { employees } from './employees';
import { projects } from './projects';

/**
 * Project team membership — pins an employee to a project as a team member,
 * with an optional free-text role note. Distinct from
 * `projects.leadEmployeeId` (the single project lead). Memberships are added
 * and removed, never edited, so this table carries ONLY `createdAt` +
 * `createdBy` — not the full timestamps()/auditColumns() set. Idempotent by
 * UNIQUE(projectId, employeeId); both FKs cascade on delete.
 */
export const projectMembers = pgTable(
  'project_members',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    /** Optional free-text role, e.g. 'designer', 'copy lead'. */
    roleNote: text(),
    createdBy: uuid(),
  },
  (t) => [
    unique('project_members_project_employee_uniq').on(t.projectId, t.employeeId),
    index().on(t.projectId),
    index().on(t.employeeId),
  ],
);

export type ProjectMember = typeof projectMembers.$inferSelect;
export type NewProjectMember = typeof projectMembers.$inferInsert;
