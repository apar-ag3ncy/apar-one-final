import { sql } from 'drizzle-orm';
import { jsonb, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { users } from './users';

/**
 * Per-user UI + application preferences — theme, dock sizing, accent, density,
 * locale/format, notification toggles, default landing app, etc.
 *
 * One row per user; a single flexible `prefs` jsonb blob keeps adding new
 * settings cheap (no migration per setting). Persisted server-side so a user's
 * settings SYNC and are REMEMBERED across sessions / devices / logins — this
 * replaces the legacy browser-localStorage store (session-store.ts) which was
 * scoped to one browser only.
 *
 * Read/written via getUserPreferences / saveUserPreferences, scoped to the
 * authenticated user (getActorContext().userId). RLS restricts each user to
 * their own row.
 */
export const userPreferences = pgTable(
  'user_preferences',
  {
    ...timestamps(),
    ...auditColumns(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    prefs: jsonb()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [uniqueIndex('user_preferences_user_unique').on(t.userId)],
);

export type UserPreferencesRow = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;
