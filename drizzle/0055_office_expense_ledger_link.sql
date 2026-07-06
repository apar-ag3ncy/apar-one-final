-- 0055_office_expense_ledger_link — link each office expense to the ledger
-- transaction it posts.
--
-- Office expenses now auto-post to the GL on save (Dr <6xxx OpEx> + Dr 1250
-- GST / Cr 1110 Cash on Hand). transaction_id points the capture row at that
-- posted journal so edits can reverse+repost and deletes can reverse it.
-- Nullable: reimbursement-category expenses and any legacy capture-only rows
-- stay unlinked. No ON DELETE — ledger transactions are immutable (never
-- hard-deleted; a delete reverses instead).

ALTER TABLE "office_expenses"
  ADD COLUMN IF NOT EXISTS "transaction_id" uuid REFERENCES "transactions"(id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "office_expenses_transaction_id_idx"
  ON "office_expenses" (transaction_id);
--> statement-breakpoint
