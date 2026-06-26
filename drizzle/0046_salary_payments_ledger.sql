-- 0046_salary_payments_ledger — post salary payments to the double-entry ledger.
--
-- Per the revised product decision, each salary payment now posts a real
-- transaction (Dr 6100 Salaries & Wages / Cr 1110 Cash on Hand), attributed to
-- the employee via the transaction header (related_entity / incurred_by). This
-- migration:
--   1. links salary_payments → transactions via a new transaction_id column;
--   2. exempts the salary_disbursement (and bonus_payment) kinds from the
--      source-document requirement — a salary payout has no invoice/bill, the
--      same way journals / inter-bank transfers don't.
--
-- The relaxed CHECK is strictly more permissive than the original, so existing
-- rows continue to satisfy it.
ALTER TABLE "salary_payments"
  ADD COLUMN IF NOT EXISTS "transaction_id" uuid REFERENCES "transactions"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salary_payments_transaction_id_index" ON "salary_payments" USING btree ("transaction_id");--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_source_document_required";--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_source_document_required" CHECK (
  source_document_id IS NOT NULL
  OR kind IN ('journal','inter_bank_transfer','salary_disbursement','bonus_payment')
  OR source_kind = 'opening_balance'
);
