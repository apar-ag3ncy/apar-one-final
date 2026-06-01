import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { timestamps } from './_ledger';

/**
 * **`audit_log`** — the diff trail. Trigger-populated per CLAUDE.md rule #38.
 *
 * This is the *diff trail* — one row per INSERT/UPDATE/DELETE on watched
 * tables, with the JSON diff in `changes`. SPEC-AMENDMENT-001 §4 + the
 * AUDIT-GAPS event registry define a separate `entity_activity_log` for
 * the *typed event stream* shown on profiles ("Aakash created the
 * client", "Vendor bill ₹35,400 recorded", etc.) — that lands in Phase 2.
 *
 * **Append-only.** RLS in `0002_audit_log_append_only.sql` blocks UPDATE
 * and DELETE for everyone including the service role. Inserts happen via
 * a trigger function (not application code). Uses the `_ledger` mixin so
 * there's no `deleted_at` column either — there's nothing to soft-delete
 * because there's no delete path.
 *
 * Renamed from `activity_log` in migration 0002 — no production data
 * existed yet (table was never trigger-populated; the trigger function
 * isn't shipped until Phase 3), so the rename is a no-op against rows.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    ...timestamps(),
    actorId: uuid(),
    entityType: text().notNull(),
    entityId: uuid().notNull(),
    action: text().notNull(), // 'insert' | 'update' | 'delete'
    changes: jsonb().notNull(),
  },
  (t) => [
    index().on(t.entityType, t.entityId, t.createdAt.desc()),
    index().on(t.actorId, t.createdAt.desc()),
  ],
);

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
