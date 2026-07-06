-- 0057_office_expense_particulars — data fix: make the office-utilities
-- ledger's Particulars read exactly like the expense description.
--
-- postExpenseToLedger used to write transactions.description as
-- "Office expense — <category>: <description>"; the ledger window shows
-- transactions.description as the Particulars column, so every row carried
-- the wrapper instead of the description the operator typed in the Office
-- app. New postings now pass the bare description; this rewrites the
-- already-posted journals (linked via office_expenses.transaction_id) the
-- same way. Idempotent: re-running just re-copies the same description.

UPDATE "transactions" t
SET "description" = CASE
  WHEN length(trim(oe."description")) >= 10 THEN left(trim(oe."description"), 480)
  ELSE left(trim(oe."description") || ' — office expense', 480)
END
FROM "office_expenses" oe
WHERE oe."transaction_id" = t."id"
  AND t."external_ref" LIKE 'OFFEXP-%';
--> statement-breakpoint
