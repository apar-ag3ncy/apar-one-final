-- 0078_transaction_amendments — amend & reissue link for posted transactions
-- (§7.2). Set on the REISSUED transaction to the original it replaces so client
-- receipts and vendor payments carry the same amendment-history chain that
-- invoices already do (0074).
--
-- The column is deliberately NOT added to the posted-immutability trigger's
-- whitelist (0007_ledger tg_block_edit_posted_transactions), so it can be
-- stamped on the reissue with a post-hoc UPDATE without tripping the trigger.
--
-- Idempotent: ADD COLUMN / CREATE INDEX IF NOT EXISTS.

ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "amended_from_transaction_id" uuid REFERENCES "transactions"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_amended_from_idx" ON "transactions" ("amended_from_transaction_id");
