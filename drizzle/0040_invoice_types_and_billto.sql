-- 0040_invoice_types_and_billto — add a document TYPE (invoice | proforma) and
-- a chosen BILL-TO address to invoices.
--
-- TYPE: a `proforma` is presented and titled as a proforma on the PDF; per the
-- product decision it otherwise behaves exactly like a tax `invoice` (same
-- per-FY numbering series + the same ledger posting on send). It is frozen once
-- the invoice leaves 'draft' (added to tg_block_edit_sent_invoices below) so a
-- sent document's nature cannot change after issuance.
--
-- BILL-TO: clients can now have multiple addresses; `bill_to_address_id` lets an
-- invoice bind to a chosen one. Nullable + ON DELETE SET NULL — when unset (or
-- the address is later removed) the PDF falls back to the registered/primary
-- address. The sent PDF already snapshots the address text, so the legal
-- artifact is unaffected; bill_to_address_id is therefore NOT frozen by the
-- immutability trigger (the FK's SET NULL must be allowed to fire post-send).

CREATE TYPE invoice_type AS ENUM ('invoice', 'proforma');
--> statement-breakpoint
ALTER TABLE invoices
  ADD COLUMN document_type invoice_type NOT NULL DEFAULT 'invoice';
--> statement-breakpoint
ALTER TABLE invoices
  ADD COLUMN bill_to_address_id uuid REFERENCES entity_addresses(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invoices_bill_to_address_id_index
  ON invoices (bill_to_address_id);
--> statement-breakpoint
-- Re-point tg_block_edit_sent_invoices to also freeze document_type once an
-- invoice leaves 'draft' (copy of the 0039 body + the document_type guard).
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
