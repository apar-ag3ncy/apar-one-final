-- 0058_salary_payment_method — salary payments capture what was DUE and how
-- the money left the company.
--
-- expected_amount_paise: the attendance-prorated gross the employee deserved
--   for the period, snapshotted at record time (previewSalaryForEmployee).
--   Nullable — legacy rows predate the capture.
-- payment_method: 'cash' (Cr 1110) or 'bank' (Cr 1120 sub-ledgered to
--   bank_account_id). Every legacy row posted cash, so the default backfills
--   them correctly.
-- bank_account_id: the agency bank (bank_accounts.id) the salary went out
--   from when payment_method = 'bank'.

ALTER TABLE "salary_payments"
  ADD COLUMN IF NOT EXISTS "expected_amount_paise" bigint;
--> statement-breakpoint

ALTER TABLE "salary_payments"
  ADD COLUMN IF NOT EXISTS "payment_method" text NOT NULL DEFAULT 'cash';
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "salary_payments"
    ADD CONSTRAINT "salary_payments_payment_method_check"
    CHECK ("payment_method" IN ('cash', 'bank'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

ALTER TABLE "salary_payments"
  ADD COLUMN IF NOT EXISTS "bank_account_id" uuid REFERENCES "bank_accounts"(id) ON DELETE SET NULL;
--> statement-breakpoint
