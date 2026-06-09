-- 0034_audit_all_business_tables — make the audit trail COMPLETE.
--
-- 0006 attached the public.log_audit_diff() trigger to only 10 entity tables
-- (clients, vendors, employees, projects + polymorphic children + role_capabilities).
-- Every other business/financial table — ledger transactions & postings, all
-- billing documents (invoices/bills/credit notes/estimates/receipts/advances +
-- their lines & allocations), payroll (salary runs/structures/bonuses/
-- reimbursements/leaves), attendance, office expenses, periods, service items,
-- billing config, tax reference, settings, etc. — had NO persistent audit row.
--
-- This migration attaches the SAME diff trigger to every remaining business
-- table that has an `id` column, so EVERY insert/update/delete is recorded in
-- audit_log with a full before/after diff. The trail is now complete and
-- future-proof: new write paths are audited automatically, no app-code change
-- required ("all logs saved throughout").
--
-- Excluded by design: log tables (audit_log, entity_activity_log), per-user UI
-- state (user_table_preferences), pure change/history logs (form_field_changes,
-- invoice_reminder_log), high-volume bank-import lines (bank_statement_lines),
-- and the two id-less join tables (client_activity_attachments/attendees).
-- Idempotent: each trigger is dropped first, so re-running is safe.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'accounts','advance_allocations','attendance_records','bank_accounts',
    'bank_statements','bill_allocations','bill_lines','billing_settings',
    'bills','bonuses_and_perks','client_activities','client_contacts',
    'credit_note_lines','credit_notes','customer_advances','documents',
    'entity_custom_values','entity_relationships','estimate_invoice_links',
    'estimate_lines','estimates','form_fields','form_templates','invoice_lines',
    'invoices','leaves','office_expenses','organizations',
    'party_billing_profiles','payment_allocations','periods','postings',
    'receipt_vouchers','receipts','refund_vouchers','reimbursements',
    'reminder_schedules','salary_lines','salary_runs','salary_structures',
    'service_items','settings','tax_reference_rates','tds_reference_sections',
    'transactions','users','validation_rules'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_audit ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_audit_diff()',
      t, t
    );
  END LOOP;
END $$;
