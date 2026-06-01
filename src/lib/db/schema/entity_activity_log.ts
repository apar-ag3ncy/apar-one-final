import { boolean, index, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { timestamps } from './_ledger';
import { entityTypeEnum } from './_polymorphic';

/**
 * Closed enum of activity event kinds. Lives on the schema side so it can
 * be re-exported to both:
 *
 *   - `lib/activity.ts` — the server-only writer (validates `kind` against
 *     this set before insert; no `import 'server-only'` here so schema
 *     consumers stay client-safe).
 *   - `drizzle/0012_event_kind_enum.sql` — the PG ENUM `event_kind` is
 *     defined from this same list. Adding an event requires a schema +
 *     migration round-trip.
 */
export const EVENT_REGISTRY = [
  // Entity lifecycle
  'entity.created',
  'entity.updated',
  'entity.archived',
  'entity.restored',
  'entity.hard_deleted',

  // Contracts
  'contract.uploaded',
  'contract.signed',
  'contract.expired',
  'contract.renewed',
  'contract.waived',

  // POCs / addresses / banks / tax IDs
  'contact.added',
  'contact.removed',
  'contact.primary_promoted',
  'address.added',
  'address.removed',
  'bank.added',
  'bank.verified',
  'bank.removed',
  'bank.revealed',
  'tax_id.added',
  'tax_id.removed',
  'tax_id.revealed',

  // Documents
  'document.uploaded',
  'document.superseded',
  'document.deleted',
  'document.viewed',
  'kyc.accessed',

  // Form Builder
  'form_template.applied',
  'form_field.value_changed',
  'form_field.deprecated',
  'form_field.restored',

  // RBAC
  'capability.granted',
  'capability.revoked',

  // Ledger (Phase 4)
  'transaction.posted',
  'transaction.reversed',
  'transaction.reconciled',
  'expense_on_behalf.added',
  'expense_on_behalf.billed_back',
  'period.soft_closed',
  'period.closed',
  'period.reopened',
  'bank.reconciled',
  'validation.acknowledged',
  'journal_voucher.created',

  // Payroll (Phase 4.5)
  'salary_run.generated',
  'salary_run.posted',
  'salary_run.reversed',
  'bonus.recorded',
  'reimbursement.submitted',
  'reimbursement.approved',
  'reimbursement.rejected',
  'reimbursement.paid',
  'leave.applied',
  'leave.approved',
  'leave.rejected',
  'leave.cancelled',

  // Employee portal (SPEC-AMENDMENT-001 §8.4)
  'achievement_added',

  // Billing module (Phase 2+) — added incrementally per phase to keep
  // the pgEnum migration small. v1 set: invoice + estimate + credit_note +
  // bill + payment lifecycle + advance/refund + reminder. New kinds
  // require ALTER TYPE event_kind ADD VALUE; see 0025_billing_event_kinds.
  'invoice.sent',
  'invoice.viewed',
  'invoice.voided',
  'invoice.paid',
  'estimate.sent',
  'estimate.accepted',
  'estimate.rejected',
  'estimate.converted',
  'credit_note.issued',
  'credit_note.voided',
  'bill.recorded',
  'bill.voided',
  'payment.received',
  'payment.allocated',
  'payment.gateway_captured',
  'payment.gateway_failed',
  'advance.received',
  'advance.allocated',
  'refund.issued',
  'reminder.sent',
  'reminder.bounced',
] as const;

export type EventKind = (typeof EVENT_REGISTRY)[number];

export const EVENT_REGISTRY_SET: ReadonlySet<EventKind> = new Set(EVENT_REGISTRY);

export const eventKindEnum = pgEnum('event_kind', EVENT_REGISTRY);

/**
 * **`entity_activity_log`** — the *typed event stream* per
 * SPEC-AMENDMENT-001 §4. Distinct from `audit_log` (the diff trail).
 *
 * One row per business event ("created the client", "contract signed
 * v2", "vendor bill ₹35,400 recorded"). Written by `lib/activity.ts`
 * server-side, NOT by triggers. Powers the real-time activity feed on
 * every entity profile (Supabase Realtime subscription on this table).
 *
 * - `entity_type` + `entity_id` are the PRIMARY entity the event is
 *   attached to.
 * - `payload.mentions` (an array of `{entityType, entityId}` objects
 *   in JSON) lists secondary entities the event references. A vendor
 *   bill with `on_behalf_of_client_id=X` writes the event keyed to the
 *   vendor, with `payload.mentions = [{entityType:'client', entityId:X}]`.
 * - Client profile feed: `WHERE entity_id=X OR payload.mentions @>
 *   '[{"entityType":"client","entityId":"X"}]'`.
 * - `is_achievement` flips when partner/admin marks an event as an
 *   achievement (SPEC-AMENDMENT-001 §8.4). Curated achievement events
 *   surface on the employee's personal dashboard.
 *
 * Append-only — same RLS pattern as `audit_log`. No update, no delete.
 * Uses `_ledger.timestamps()` mixin (no deleted_at).
 */
export const entityActivityLog = pgTable(
  'entity_activity_log',
  {
    ...timestamps(),
    entityType: entityTypeEnum().notNull(),
    entityId: uuid().notNull(),

    actorId: uuid(), // user who triggered the event; null for system events
    kind: eventKindEnum().notNull(), // closed enum sourced from EVENT_REGISTRY above
    summary: text().notNull(), // human-readable one-liner
    payload: jsonb().notNull().default({}),

    // Achievement curation (SPEC-AMENDMENT-001 §8.4)
    isAchievement: boolean().notNull().default(false),
  },
  (t) => [
    index().on(t.entityType, t.entityId, t.createdAt.desc()),
    index().on(t.actorId, t.createdAt.desc()),
    index().on(t.kind),
    index().on(t.isAchievement),
  ],
);

export type EntityActivityLog = typeof entityActivityLog.$inferSelect;
export type NewEntityActivityLog = typeof entityActivityLog.$inferInsert;
