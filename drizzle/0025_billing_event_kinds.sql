-- Billing Phase 2.3b — extend the `event_kind` pgEnum with the billing
-- module's lifecycle events. EVENT_REGISTRY in
-- `src/lib/db/schema/entity_activity_log.ts` is the source of truth;
-- `logActivity` will refuse any kind not in the enum.
--
-- Front-loaded with the full billing event set (invoice / estimate /
-- credit_note / bill / payment / advance / refund / reminder) even though
-- only invoice.sent and invoice.voided are wired in this phase commit.
-- Later phases (5, 6, 4, 9) consume the rest without a follow-up
-- migration. ALTER TYPE ... ADD VALUE IF NOT EXISTS is idempotent.

ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'invoice.sent';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'invoice.viewed';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'invoice.voided';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'invoice.paid';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'estimate.sent';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'estimate.accepted';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'estimate.rejected';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'estimate.converted';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'credit_note.issued';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'credit_note.voided';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'bill.recorded';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'bill.voided';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'payment.received';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'payment.allocated';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'payment.gateway_captured';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'payment.gateway_failed';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'advance.received';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'advance.allocated';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'refund.issued';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'reminder.sent';
--> statement-breakpoint
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'reminder.bounced';
--> statement-breakpoint
