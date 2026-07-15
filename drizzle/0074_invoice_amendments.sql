-- 0074_invoice_amendments — "Amend & reissue" linkage for client invoices.
--
-- invoices.amended_from_invoice_id — when a SENT invoice is amended, the system
-- voids the original (reversing its ledger posting) and creates a fresh editable
-- DRAFT reissue (new number) that records the ORIGINAL's id here. The reissue is
-- then edited and sent, posting a fresh ledger entry. This preserves posted-
-- invoice immutability (we never edit a posted row in place — we reverse + clone).
--
-- Mirrors converted_from_invoice_id: a plain uuid with NO foreign-key constraint
-- (kept FK-free like transactions.reverses_id), set only at draft-insert time, so
-- the sent-invoice immutability trigger never sees it change on a posted row.

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "amended_from_invoice_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_amended_from_invoice_id_idx" ON "invoices" ("amended_from_invoice_id");
