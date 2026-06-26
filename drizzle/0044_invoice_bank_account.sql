-- 0044_invoice_bank_account — let an invoice choose WHICH company bank account
-- prints in its payment block, instead of always falling back to the primary.
--
-- bank_account_id is nullable + ON DELETE SET NULL: unset ⇒ the renderer uses
-- the primary account; an account can be retired without orphaning past
-- invoices. Company bank accounts are soft-deleted (deleted_at) by the app, so
-- this SET NULL never actually fires on a sent row — which is what makes
-- freezing the column below safe (mirrors theme_id, 0039/0040).
--
-- Frozen once the invoice leaves 'draft': a sent invoice's stored PDF is the
-- legal artifact and the printed account must stay put. Re-point
-- tg_block_edit_sent_invoices to also guard bank_account_id (copy of the 0040
-- body + the bank_account_id check).

ALTER TABLE invoices
  ADD COLUMN bank_account_id uuid REFERENCES company_bank_accounts(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invoices_bank_account_id_index
  ON invoices (bank_account_id);
--> statement-breakpoint
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
