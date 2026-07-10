import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Server-backed OS user accounts (the /os lock-screen login).
 *
 * These used to live only in the creating browser's localStorage, so an
 * account made on one device could not be signed into from another. This table
 * persists them server-side; passwords are scrypt-hashed by
 * `src/lib/server/os-auth.ts` (never stored in plaintext). The built-in super
 * admin (`id = 'super-admin'`, username `apar`) is upserted on demand by
 * `ensureOsSuperAdmin()` so the operator can never be locked out.
 *
 * `id` is a plain text PK (`'super-admin'` for the built-in, `'u-<hex>'` for
 * the rest) rather than a uuid, matching the ids the client store has always
 * used for per-user storage keys. `permissions` is the opaque OS RBAC map
 * (`Record<AppId, {view,edit,delete}>`) — the server stores it verbatim; the
 * client owns its shape.
 */
export const osUsers = pgTable(
  'os_users',
  {
    id: text().primaryKey(),
    username: text().notNull(),
    fullName: text().notNull(),
    passwordHash: text().notNull(),
    role: text().notNull().default('admin'), // 'super_admin' | 'admin' | 'user'
    tone: text().notNull().default('#B5391E'),
    permissions: jsonb().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    // Case-insensitive unique username among live rows.
    uniqueIndex('os_users_username_lower_unique')
      .on(sql`lower(${t.username})`)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export type OsUserRow = typeof osUsers.$inferSelect;
