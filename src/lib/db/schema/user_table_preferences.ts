import { boolean, index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { users } from './users';

/**
 * SPEC-AMENDMENT-001 §6.2 — per-user table state.
 *
 * One row per (user, table_key, view_name). `view_name` NULL is the
 * implicit default ("my current state for this table"); non-null is
 * a saved view shareable via URL.
 *
 * `tableKey` examples:
 *   - 'clients.list'
 *   - 'vendors.transactions'
 *   - 'client.<uuid>.projects'
 *   - 'reports.per_client_pnl'
 *
 * Server actions: `getUserTablePreference`, `saveUserTablePreference`,
 * `listSavedViews`, `deleteSavedView`. RLS: each user can read/write
 * their own rows only.
 */
export const userTablePreferences = pgTable(
  'user_table_preferences',
  {
    ...timestamps(),
    ...auditColumns(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tableKey: text().notNull(),
    viewName: text(), // NULL = the implicit "current" pref

    visibleColumns: text().array(), // ordered column-key array
    filters: jsonb(),
    sort: jsonb(),

    isDefault: boolean().notNull().default(false),
    isShared: boolean().notNull().default(false), // share view org-wide (CLAUDE rule #14)
  },
  (t) => [
    uniqueIndex('user_table_preferences_user_table_view_unique').on(
      t.userId,
      t.tableKey,
      t.viewName,
    ),
    index().on(t.userId, t.tableKey),
    index().on(t.tableKey, t.isShared),
  ],
);

export type UserTablePreference = typeof userTablePreferences.$inferSelect;
export type NewUserTablePreference = typeof userTablePreferences.$inferInsert;
