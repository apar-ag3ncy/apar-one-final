-- Payroll deletability — extend the `event_kind` pgEnum with delete/restore
-- lifecycle events for salary payments, salary structures (salary updates)
-- and bonuses, so the employee Activity tab (30-day retention) and the Trash
-- log can record who removed what. EVENT_REGISTRY in
-- `src/lib/db/schema/entity_activity_log.ts` is the source of truth.
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS is idempotent (same pattern as 0025).

ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'salary_payment.deleted';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'salary_payment.restored';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'salary_structure.deleted';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'salary_structure.restored';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'bonus.deleted';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'bonus.restored';
