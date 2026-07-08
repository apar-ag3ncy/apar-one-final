-- 0062_invoice_project_links — per-line project attribution, proforma→invoice
-- conversion linkage, and the retainer flag.
--
-- (1) invoice_lines.project_id — each line can be tagged to a project or
--     sub-project, so ONE invoice may span several projects and "amount
--     received per project" can be apportioned line-wise. Nullable; untagged
--     lines fall back to the header invoices.project_id (COALESCE at read
--     time). RESTRICT on delete: a project referenced by billed lines can't
--     be hard-deleted (same stance as invoices.project_id).
-- (2) invoices.converted_from_invoice_id — when a proforma is converted
--     ("amended") into a tax invoice, the new invoice records its source
--     here. Previously the linkage lived only in the idempotency-key
--     convention 'proforma-conv:<proformaId>' — backfilled below. SET NULL
--     on source delete (only drafts are deletable, and a converted proforma
--     is sent, so this effectively never fires).
-- (3) invoices.covered_under_retainer — flags an invoice as billing work
--     covered by a client retainer. Pure capture; no posting impact.
--
-- (4) tg_block_edit_sent_invoices is REDEFINED from the 0044 body with
--     exactly ONE change: the project_id comparison is dropped, so an
--     already-sent invoice can be (re)linked to a project. Project linkage
--     is management attribution, not part of the legal artifact (the PDF
--     doesn't print it). Everything else stays frozen. The two new invoice
--     columns are deliberately NOT in the frozen list: the conversion
--     backfill below must touch sent rows, and a retainer mis-tag must be
--     fixable after send.

ALTER TABLE "invoice_lines"
  ADD COLUMN IF NOT EXISTS "project_id" uuid REFERENCES "projects"(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_lines_project_id_idx"
  ON "invoice_lines" (project_id);
--> statement-breakpoint

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "converted_from_invoice_id" uuid REFERENCES "invoices"(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_converted_from_invoice_id_idx"
  ON "invoices" (converted_from_invoice_id);
--> statement-breakpoint

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "covered_under_retainer" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- Copy of the 0044 function body with the project_id comparison removed and
-- nothing else touched. Any later migration amending this function must start
-- from THIS body.
CREATE OR REPLACE FUNCTION tg_block_edit_sent_invoices()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'draft' THEN
    RETURN NEW; -- drafts freely editable
  END IF;

  -- Compare non-whitelisted columns; raise if any changed.
  IF NEW.document_number IS DISTINCT FROM OLD.document_number
  OR NEW.document_type IS DISTINCT FROM OLD.document_type
  OR NEW.document_date IS DISTINCT FROM OLD.document_date
  OR NEW.due_date IS DISTINCT FROM OLD.due_date
  OR NEW.financial_year_start IS DISTINCT FROM OLD.financial_year_start
  OR NEW.client_id IS DISTINCT FROM OLD.client_id
  OR NEW.subtotal_paise IS DISTINCT FROM OLD.subtotal_paise
  OR NEW.captured_tax_total_paise IS DISTINCT FROM OLD.captured_tax_total_paise
  OR NEW.captured_total_paise IS DISTINCT FROM OLD.captured_total_paise
  OR NEW.place_of_supply IS DISTINCT FROM OLD.place_of_supply
  OR NEW.captured_tax_split IS DISTINCT FROM OLD.captured_tax_split
  OR NEW.terms IS DISTINCT FROM OLD.terms
  OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
  OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id
  OR NEW.theme_id IS DISTINCT FROM OLD.theme_id
  OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
  THEN
    RAISE EXCEPTION
      'invoice % is %; only whitelisted columns may be updated', OLD.id, OLD.state
      USING ERRCODE = 'restrict_violation',
            HINT = 'Edit a draft, or issue a credit note. LEDGER-SPEC §8.4.';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Backfill conversion linkage from the existing idempotency-key convention
-- ('proforma-conv:<proformaId>', src/lib/server/billing/proforma-conversion.ts).
-- BEFORE UPDATE triggers only reject changes to frozen columns, and
-- converted_from_invoice_id isn't frozen, so this passes on sent rows.
UPDATE "invoices"
SET converted_from_invoice_id = substring(idempotency_key FROM 15)::uuid
WHERE idempotency_key LIKE 'proforma-conv:%'
  AND converted_from_invoice_id IS NULL
  AND substring(idempotency_key FROM 15) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
--> statement-breakpoint
