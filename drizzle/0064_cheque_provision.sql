-- 0064_cheque_provision — cheque as a first-class payment method everywhere
-- money is recorded, with structured cheque number + date.
--
-- Cheque money still moves through the bank (Dr/Cr 1120) — no posting-template
-- change. What changes is capture:
--   - office_expense_payment_method enum gains 'cheque' (ALTER TYPE ADD VALUE
--     is idempotent; the new value is not USED in this migration — PG forbids
--     using an enum value added in the same transaction. Precedent: 0025.)
--   - office_expenses, receipts, salary_payments each gain nullable
--     cheque_number / cheque_date capture columns.
--   - salary_payments.payment_method CHECK (text column, 0058) is widened to
--     allow 'cheque' (drop + re-add; CHECKs have no ADD VALUE).
--
-- Client-receipt and vendor-payment flows post transactions with per-leg
-- JSONB metadata — cheque details ride in the metadata there, no DDL needed.

ALTER TYPE office_expense_payment_method ADD VALUE IF NOT EXISTS 'cheque';
--> statement-breakpoint

ALTER TABLE "office_expenses"
  ADD COLUMN IF NOT EXISTS "cheque_number" text;
--> statement-breakpoint
ALTER TABLE "office_expenses"
  ADD COLUMN IF NOT EXISTS "cheque_date" date;
--> statement-breakpoint

ALTER TABLE "receipts"
  ADD COLUMN IF NOT EXISTS "cheque_number" text;
--> statement-breakpoint
ALTER TABLE "receipts"
  ADD COLUMN IF NOT EXISTS "cheque_date" date;
--> statement-breakpoint

ALTER TABLE "salary_payments"
  ADD COLUMN IF NOT EXISTS "cheque_number" text;
--> statement-breakpoint
ALTER TABLE "salary_payments"
  ADD COLUMN IF NOT EXISTS "cheque_date" date;
--> statement-breakpoint

ALTER TABLE "salary_payments"
  DROP CONSTRAINT IF EXISTS "salary_payments_payment_method_check";
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "salary_payments"
    ADD CONSTRAINT "salary_payments_payment_method_check"
    CHECK ("payment_method" IN ('cash', 'bank', 'cheque'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
