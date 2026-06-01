import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Standard columns required on every business table per CLAUDE.md rule #37.
 * Spread into a Drizzle pgTable definition:
 *
 *   pgTable('clients', { ...timestamps(), ...auditColumns(), name: text(...) })
 */
export const timestamps = () => ({
  id: uuid()
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp({ withTimezone: true }),
});

/**
 * created_by / updated_by columns — FK to `users.id`. Kept separate from
 * `timestamps()` so that tables not owned by a user (e.g. trigger-populated
 * `activity_log`) can opt out.
 */
export const auditColumns = () => ({
  createdBy: uuid(),
  updatedBy: uuid(),
});
