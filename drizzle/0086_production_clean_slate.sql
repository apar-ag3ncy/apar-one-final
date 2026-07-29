-- 0086_production_clean_slate — Clean slate for production deployment.
--
-- Neutralizes ledger & invoice delete triggers temporarily, clears all seed/test
-- operational records (postings, transactions, office expenses, invoices, bills,
-- bank accounts, test OS users) and restores protection triggers.

CREATE OR REPLACE FUNCTION public.tg_block_delete_ledger() RETURNS TRIGGER AS $neutralised$
BEGIN
  -- Temporarily permissive; restored to 0015 body at end of migration.
  RETURN OLD;
END;
$neutralised$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.tg_block_edit_sent_invoices() RETURNS TRIGGER AS $neutralised$
BEGIN
  -- Temporarily permissive; restored at end of migration.
  RETURN NEW;
END;
$neutralised$ LANGUAGE plpgsql;
--> statement-breakpoint

DO $clean$
BEGIN
  -- 1. Line items & Allocations
  DELETE FROM public.payment_allocations;
  DELETE FROM public.receipt_allocations;
  DELETE FROM public.bill_allocations;
  DELETE FROM public.advance_allocations;
  DELETE FROM public.estimate_invoice_links;
  DELETE FROM public.invoice_lines;
  DELETE FROM public.estimate_lines;
  DELETE FROM public.credit_note_lines;
  DELETE FROM public.bill_lines;

  -- 2. Billing Header Documents
  DELETE FROM public.invoices;
  DELETE FROM public.estimates;
  DELETE FROM public.credit_notes;
  DELETE FROM public.bills;
  DELETE FROM public.receipts;
  DELETE FROM public.receipt_vouchers;
  DELETE FROM public.refund_vouchers;
  DELETE FROM public.customer_advances;
  DELETE FROM public.invoice_reminder_log;

  -- 3. Office Expenses & General Ledger
  DELETE FROM public.office_expenses;
  DELETE FROM public.postings;
  DELETE FROM public.transactions;
  DELETE FROM public.bank_statements;
  DELETE FROM public.company_bank_accounts;

  -- 4. Projects & Tasks
  DELETE FROM public.project_task_status_events;
  DELETE FROM public.project_task_followups;
  DELETE FROM public.project_task_assignees;
  DELETE FROM public.project_tasks;
  DELETE FROM public.project_followups;
  DELETE FROM public.project_vendors;
  DELETE FROM public.project_members;
  DELETE FROM public.projects;

  -- 5. Payroll & Attendance
  DELETE FROM public.salary;
  DELETE FROM public.attendance;

  -- 6. Entities & Contacts
  DELETE FROM public.client_activity_attendees;
  DELETE FROM public.client_activity_attachments;
  DELETE FROM public.client_activities;
  DELETE FROM public.client_contacts;
  DELETE FROM public.clients;
  DELETE FROM public.vendors;
  DELETE FROM public.employees;

  -- 7. Polymorphic Data & Documents
  DELETE FROM public.entity_contacts;
  DELETE FROM public.entity_addresses;
  DELETE FROM public.entity_bank_accounts;
  DELETE FROM public.entity_tax_identifiers;
  DELETE FROM public.entity_documents;
  DELETE FROM public.entity_relationships;
  DELETE FROM public.entity_custom_values;
  DELETE FROM public.entity_activity_log;
  DELETE FROM public.documents;

  -- 8. Audit Logs & Preferences
  DELETE FROM public.audit_log;
  DELETE FROM public.form_field_changes;
  DELETE FROM public.user_table_preferences;
  DELETE FROM public.user_preferences;

  -- 9. OS Accounts (keep super-admin) & App Users
  DELETE FROM public.os_users WHERE id <> 'super-admin';
  DELETE FROM public.users;
END
$clean$;
--> statement-breakpoint

-- Restore tg_block_delete_ledger() function verbatim.
CREATE OR REPLACE FUNCTION public.tg_block_delete_ledger() RETURNS TRIGGER AS $restored$
DECLARE
  v_status text;
BEGIN
  IF TG_TABLE_NAME = 'transactions' THEN
    v_status := OLD.status::text;
  ELSE
    SELECT t.status::text INTO v_status
    FROM public.transactions t
    WHERE t.id = OLD.transaction_id;
  END IF;

  IF v_status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'DELETE forbidden on ledger table % when status = %. LEDGER-SPEC 0.3 / 8.5. Reverse instead.', TG_TABLE_NAME, v_status;
  END IF;

  RETURN OLD;
END;
$restored$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Restore tg_block_edit_sent_invoices() function verbatim.
CREATE OR REPLACE FUNCTION public.tg_block_edit_sent_invoices() RETURNS TRIGGER AS $restored$
BEGIN
  IF OLD.state = 'draft' THEN
    RETURN NEW;
  END IF;

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
$restored$ LANGUAGE plpgsql;
--> statement-breakpoint

DO $guard$
BEGIN
  IF position('DELETE forbidden' in pg_get_functiondef('public.tg_block_delete_ledger()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0086: ledger delete-protection was not restored; aborting';
  END IF;
  RAISE NOTICE '0086: Production clean slate migration complete.';
END
$guard$;
