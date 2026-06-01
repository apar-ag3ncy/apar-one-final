import { index, pgEnum, pgTable, text } from 'drizzle-orm/pg-core';

import { timestamps } from './_shared';

export const userRoleEnum = pgEnum('user_role', [
  'partner',
  'admin',
  'manager',
  'accountant',
  'employee',
  'viewer',
]);

/**
 * Application user. Mirrors `auth.users.id` from Supabase Auth (kept in sync by
 * a Postgres trigger that fires on `auth.users` INSERT — added in a later
 * migration). The `id` column is NOT a Drizzle FK because `auth.users` lives in
 * a Supabase-managed schema we do not own.
 */
export const users = pgTable(
  'users',
  {
    ...timestamps(),
    role: userRoleEnum().notNull().default('employee'),
    fullName: text().notNull(),
    email: text().notNull().unique(),
    // Masked-only displays per DPDP rule #28. Full PAN/Aadhaar live in the
    // encrypted KYC document blob, never in this row.
    maskedPan: text(),
    maskedAadhaar: text(),
  },
  (t) => [index().on(t.email), index().on(t.role)],
);
