import { index, mysqlEnum, mysqlTable, varchar } from 'drizzle-orm/mysql-core';

import { timestamps } from './_shared';

/**
 * Shared value list so the enum can be reused by column (MySQL enums are
 * per-column, unlike Postgres named enum types).
 */
export const USER_ROLES = [
  'partner',
  'admin',
  'manager',
  'accountant',
  'employee',
  'viewer',
] as const;

/**
 * Application user (MariaDB port of ../schema/users.ts). Post-migration this is
 * the single source of truth — there is no separate Supabase `auth.users` to
 * mirror once self-hosted auth (Stage 5) lands.
 */
export const users = mysqlTable(
  'users',
  {
    ...timestamps(),
    role: mysqlEnum('role', USER_ROLES).notNull().default('employee'),
    fullName: varchar({ length: 256 }).notNull(),
    email: varchar({ length: 320 }).notNull().unique(),
    maskedPan: varchar({ length: 32 }),
    maskedAadhaar: varchar({ length: 32 }),
  },
  (t) => [index('users_email_idx').on(t.email), index('users_role_idx').on(t.role)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
