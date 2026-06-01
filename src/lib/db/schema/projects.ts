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

    name: text().notNull(),
    code: text(), // optional short code: 'LODHA-DIWALI-26'
    status: projectStatusEnum().notNull().default('pitch'),
    /** Captured SOW amount in paise. Apār doesn't compute — entered as-is. */
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
  ],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
