import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { projects } from './projects';
import { vendors } from './vendors';

/**
 * Project vendors — pins a vendor to a project (the supplier-side mirror of
 * `project_members`), with an optional free-text role. Links are added and
 * removed, never edited, so this table carries ONLY `createdAt` +
 * `createdBy` — not the full timestamps()/auditColumns() set. Idempotent by
 * UNIQUE(projectId, vendorId); both FKs cascade on delete. (0072)
 */
export const projectVendors = pgTable(
  'project_vendors',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    vendorId: uuid()
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    /** Optional free-text role, e.g. 'printer', 'photographer'. */
    role: text(),
    createdBy: uuid(),
  },
  (t) => [
    unique('project_vendors_project_vendor_uniq').on(t.projectId, t.vendorId),
    index().on(t.projectId),
    index().on(t.vendorId),
  ],
);

export type ProjectVendor = typeof projectVendors.$inferSelect;
export type NewProjectVendor = typeof projectVendors.$inferInsert;
