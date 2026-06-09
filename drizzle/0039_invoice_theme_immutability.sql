-- 0039_invoice_theme_immutability — freeze invoices.theme_id once an invoice
-- leaves 'draft'.
--
-- 0037 added theme_id (the selected visual theme), but the
-- tg_block_edit_sent_invoices guard (0019) predates it, so the DB layer would
-- permit re-theming a sent/paid/void invoice. A sent invoice's stored PDF is
-- the legal artifact and its appearance must stay frozen (LEDGER-SPEC §8.4).
-- The application already blocks this via updateDraftInvoice's draft-only
-- guard; this closes the defense-in-depth gap at the database by adding
-- theme_id to the trigger's blocked-change set. CREATE OR REPLACE is
-- idempotent and re-points the existing trigger at the new body.

CREATE OR REPLACE FUNCTION tg_block_edit_sent_invoices()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'draft' THEN
    RETURN NEW; -- drafts freely editable
  END IF;

  -- Compare non-whitelisted columns; raise if any changed.
  IF NEW.document_number IS DISTINCT FROM OLD.document_number
  OR NEW.document_date IS DISTINCT FROM OLD.document_date
  OR NEW.due_date IS DISTINCT FROM OLD.due_date
  OR NEW.financial_year_start IS DISTINCT FROM OLD.financial_year_start
  OR NEW.client_id IS DISTINCT FROM OLD.client_id
  OR NEW.project_id IS DISTINCT FROM OLD.project_id
  OR NEW.subtotal_paise IS DISTINCT FROM OLD.subtotal_paise
  OR NEW.captured_tax_total_paise IS DISTINCT FROM OLD.captured_tax_total_paise
  OR NEW.captured_total_paise IS DISTINCT FROM OLD.captured_total_paise
  OR NEW.place_of_supply IS DISTINCT FROM OLD.place_of_supply
  OR NEW.captured_tax_split IS DISTINCT FROM OLD.captured_tax_split
  OR NEW.terms IS DISTINCT FROM OLD.terms
  OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
  OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id
  OR NEW.theme_id IS DISTINCT FROM OLD.theme_id
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
