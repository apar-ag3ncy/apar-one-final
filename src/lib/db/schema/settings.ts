import { boolean, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';

/**
 * Singleton key/value settings table. Holds:
 *   - `enforce_period_close` (bool, default false) — LEDGER-SPEC §7
 *   - `capitalization_threshold_paise` (int, default 500000 = ₹5,000)
 *     — LEDGER-SPEC §10.5 + prompt decision
 *   - `document_max_size_mb` (int, default 25) — SPEC-AMENDMENT-001 §10.3
 *   - `extraction_auto_confirm` (bool, default false) — CLAUDE.md
 *   - `default_period_id` (uuid, the current open period) — Phase 4 cache
 *
 * Single row enforced via UNIQUE on a synthetic singleton key.
 */
export const settings = pgTable(
  'settings',
  {
    ...timestamps(),
    ...auditColumns(),
    key: text().notNull(),
    valueBool: boolean(),
    valueInt: integer(),
    valueText: text(),
    valueJson: jsonb(),
    description: text(),
  },
  (t) => [uniqueIndex('settings_key_unique').on(t.key)],
);

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
