-- 0012 — two schema repairs that follow the post-BACKEND-STATE.md audit:
--
--   1. `reimbursements.project_id` was a bare uuid column; the Drizzle
--      schema now references projects(id) ON DELETE RESTRICT. Add the FK
--      constraint at the DB layer to match. RESTRICT (not SET NULL) so a
--      project deletion is forced to acknowledge the dangling
--      reimbursement.
--
--   2. `entity_activity_log.kind` was `text NOT NULL`. The intent (per
--      SPEC-AMENDMENT-001 §4 + AUDIT-GAPS §6) is a CLOSED enum sourced
--      from lib/activity.ts EVENT_REGISTRY. Convert in one
--      ALTER COLUMN ... TYPE pass: PG accepts text → enum casts when
--      every existing value is a valid enum label. The EVENT_REGISTRY
--      has been the canonical writer's vocabulary since 0003, so no
--      backfill required. If a stray row exists with a kind outside the
--      enum, this migration will refuse — and that row should be fixed
--      by hand (or deleted, since the kind is invalid).
--
-- (`settings.document_max_size_mb` is already seeded in 0007_ledger.sql.)
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1. reimbursements.project_id FK ──────────────────────────────────────

ALTER TABLE "reimbursements"
  ADD CONSTRAINT "reimbursements_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE RESTRICT;
--> statement-breakpoint

-- ── 2. entity_activity_log.kind: text → event_kind enum ──────────────────

-- Order matters: the enum values must be quoted exactly as the writer
-- emits them. This list is the SAME tuple that
-- `lib/db/schema/entity_activity_log.ts` exports as EVENT_REGISTRY, so
-- adding an event in TS without re-running drizzle-kit generate is a
-- visible mistake (Drizzle's introspect will flag the diff).

CREATE TYPE "public"."event_kind" AS ENUM (
  'entity.created',
  'entity.updated',
  'entity.archived',
  'entity.restored',
  'entity.hard_deleted',
  'contract.uploaded',
  'contract.signed',
  'contract.expired',
  'contract.renewed',
  'contract.waived',
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
  'document.uploaded',
  'document.superseded',
  'document.deleted',
  'document.viewed',
  'kyc.accessed',
  'form_template.applied',
  'form_field.value_changed',
  'form_field.deprecated',
  'form_field.restored',
  'capability.granted',
  'capability.revoked',
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
  'achievement_added'
);
--> statement-breakpoint

ALTER TABLE "entity_activity_log"
  ALTER COLUMN "kind" TYPE "public"."event_kind"
  USING ("kind"::"public"."event_kind");
