import {
  bigint,
  boolean,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { clients } from './clients';
import { employees } from './employees';
import { entityContacts } from './entity_contacts';
import { users } from './users';

export const projectStatusEnum = pgEnum('project_status', [
  'pitch',
  'won',
  'active',
  'on_hold',
  'completed',
  'cancelled',
]);

/**
 * Projects. SPEC-AMENDMENT-001 §7.1 invariant 2: a project without a
 * client isn't a project, it's overhead. `clientId` is NOT NULL.
 *
 * `leadEmployeeId` is the employee's primary point of contact / project
 * lead — drives the employee profile's "Projects I lead" widget.
 *
 * Soft-archive same as clients/vendors/employees. Hard delete is partner +
 * dependents-check (no posted txns reference this project).
 */
export const projects = pgTable(
  'projects',
  {
    ...timestamps(),
    ...auditColumns(),
    clientId: uuid()
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    leadEmployeeId: uuid().references(() => employees.id, {
      onDelete: 'set null',
    }),
    accountManagerId: uuid().references(() => users.id, { onDelete: 'set null' }),
    /**
     * One-level sub-projects (0061). A sub-project is a full project row
     * (own fee, team, deliverables) under a parent. Self-FK RESTRICT lives
     * in the SQL migration (kept a plain uuid here like
     * transactions.reversesId to avoid the circular reference).
     * tg_projects_one_level_nesting enforces single-level nesting + client
     * inheritance at the DB.
     */
    parentProjectId: uuid(),
    /**
     * Client-side POC for this project — one of the client's entity_contacts
     * rows. SET NULL on contact delete (0061).
     */
    clientContactId: uuid().references(() => entityContacts.id, {
      onDelete: 'set null',
    }),

    name: text().notNull(),
    code: text(), // short code: 'LODHA-DIWALI-26'; auto 'PRJ-NNNN' when left blank (0063)
    status: projectStatusEnum().notNull().default('pitch'),
    /**
     * Project priority (§4.2) — urgent/high/normal/low. text + CHECK (in the
     * SQL migration) to match the project_tasks priority pattern. External
     * projects float above internal ones in the board by a sort rule, not by
     * mutating this column.
     */
    priority: text().notNull().default('normal'),
    /** Came from outside Apar (external) vs internal work (§4.2). */
    isExternal: boolean().notNull().default(false),
    /** Owning department, for the department-wise focus view (§4.2). */
    department: text(),
    /** Captured SOW amount in paise. Apar doesn't compute — entered as-is. */
    feePaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    startedOn: date(),
    targetEndOn: date(),
    completedOn: date(),
    notes: text(),

    // Archive
    isArchived: boolean().notNull().default(false),
    archivedAt: timestamp({ withTimezone: true }),
    archivedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index().on(t.clientId),
    index().on(t.leadEmployeeId),
    index().on(t.status),
    index().on(t.name),
    index().on(t.isArchived),
    index().on(t.parentProjectId),
    index().on(t.clientContactId),
    index().on(t.priority),
    index().on(t.department),
  ],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
