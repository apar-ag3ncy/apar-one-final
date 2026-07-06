// Polymorphic-shared enums (must come before tables that reference them)
export * from './_polymorphic';

// Principal entities
export * from './organizations';

// Company settings (Apar's own profile docs + bank accounts)
export * from './company_bank_accounts';
export * from './company_documents';
export * from './company_holidays';
export * from './users';
export * from './clients';
export * from './vendors';
export * from './employees';
export * from './projects';
export * from './project_members';
export * from './project_tasks';

// Polymorphic children
export * from './entity_contacts';
export * from './entity_addresses';
export * from './entity_bank_accounts';
export * from './entity_tax_identifiers';
export * from './entity_documents';
export * from './entity_relationships';
export * from './entity_custom_values';
export * from './entity_activity_log';

// Documents (storage-ref base)
export * from './documents';

// Client activities (timeline / meeting log) — kept around for the
// existing frontend until B converges on the unified
// `entity_activity_log`.
export * from './client_activities';
export * from './client_activity_attachments';
export * from './client_activity_attendees';
export * from './client_contacts';

// Form Builder
export * from './form_templates';
export * from './form_fields';
export * from './form_field_changes';

// RBAC
export * from './role_capabilities';

// User-facing state
export * from './user_table_preferences';
export * from './user_preferences';

// Audit
export * from './audit_log';

// Ledger module (Phase 4)
export * from './accounts';
export * from './periods';
export * from './bank_accounts';
export * from './transactions';
export * from './bank_statements';
export * from './validation_rules';
export * from './settings';

// Payroll (Phase 4.5)
export * from './salary';

// Attendance
export * from './attendance';

// Office expenses (lightweight system-of-record for everyday outflows)
export * from './office_expenses';
export * from './office_expense_categories';

// Department registry (managed taxonomy for the Employees module)
export * from './departments';

// Billing module (Phase 1)
export * from './service_items';
export * from './party_billing_profiles';
export * from './invoice_themes';
export * from './invoices';
export * from './invoice_lines';
export * from './estimates';
export * from './estimate_lines';
export * from './estimate_invoice_links';
export * from './credit_notes';
export * from './credit_note_lines';
export * from './bills';
export * from './bill_lines';
export * from './receipts';
export * from './payment_allocations';
export * from './bill_allocations';
export * from './receipt_allocations';
export * from './receipt_vouchers';
export * from './customer_advances';
export * from './advance_allocations';
export * from './refund_vouchers';
export * from './tds_reference_sections';
export * from './invoice_reminder_log';
export * from './billing_settings';

// Billing materialized views (Phase 7)
export * from './billing_views';

// Reminder schedules (Phase 9)
export * from './reminder_schedules';

// Settings → Vault (password-protected credential store)
export * from './vault';
