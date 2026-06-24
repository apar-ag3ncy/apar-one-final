/**
 * Capability + role definitions shared by server (rbac gating) and client
 * (the Settings → Roles matrix). This module is intentionally NOT
 * 'server-only': `lib/rbac.ts` re-exports everything here for server code,
 * while client components import the same single source of truth directly.
 *
 * Closed enum of capability strings. Adding a capability requires a code
 * change here AND a row in `role_capabilities` (seeded by migration).
 * AUDIT-GAPS §3: "Capabilities are a closed enum in code, not free text.
 * Otherwise you've built a second permission system on top of the first."
 *
 * Order follows the agent-backend brief Phase 3 list, then
 * SPEC-AMENDMENT-001 §11 additions.
 */
export const CAPABILITIES = [
  // Original brief Phase 3 list
  'manage_form_templates',
  'manage_role_capabilities',
  'create_client',
  'update_client',
  'archive_client',
  'create_vendor',
  'update_vendor',
  'archive_vendor',
  'create_employee',
  'update_employee',
  'archive_employee',
  'reveal_kyc',
  'reveal_bank',
  'upload_document',
  'delete_document',
  'post_transaction',
  'reconcile_transaction',
  'reverse_transaction',
  'manage_users',
  'view_audit_log',
  'manage_periods',
  'close_period',
  'reopen_period',
  'manage_validation_rules',
  'manage_tax_rates',
  'create_journal_voucher',
  'manage_bank_accounts',

  // SPEC-AMENDMENT-001 §11 additions
  'restore_client',
  'restore_vendor',
  'restore_employee',
  'hard_delete_client',
  'hard_delete_vendor',
  'hard_delete_employee',
  'hard_delete_document',
  'hard_delete_custom_field',
  'portal_access',
  'manage_salary_structures',
  'create_salary_run',
  'post_salary_run',
  'reverse_salary_run',
  'view_salary',
  'record_bonus_or_perk',
  'approve_reimbursement',
  'approve_leave',
  'manage_leaves',
  'mark_achievement',
  'manage_user_table_preferences',

  // Billing module (Phase 1.5)
  'create_invoice',
  'send_invoice',
  'void_invoice',
  'manage_credit_note',
  'manage_estimate',
  'receive_payment',
  'manage_recurring',
  'manage_billing_settings',
  'manage_service_items',
  'manage_party_billing_profile',
  'view_gst_reports',
  'manage_tax_reference_sections',
  'manage_invoice_themes',

  // Company settings (Settings → Company details / Billing)
  'manage_company_profile',

  // Settings → Vault (password-protected credential store)
  'manage_vault',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_SET: ReadonlySet<Capability> = new Set(CAPABILITIES);

/**
 * Human-readable labels for each capability — used by the Settings → Security
 * panel and the roles matrix. `Record<Capability, …>` forces this map to stay
 * exhaustive: adding a capability above without a label here is a compile
 * error.
 */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  manage_form_templates: 'Manage form templates',
  manage_role_capabilities: 'Manage roles & permissions',
  create_client: 'Create clients',
  update_client: 'Edit clients',
  archive_client: 'Archive clients',
  create_vendor: 'Create vendors',
  update_vendor: 'Edit vendors',
  archive_vendor: 'Archive vendors',
  create_employee: 'Create employees',
  update_employee: 'Edit employees',
  archive_employee: 'Archive employees',
  reveal_kyc: 'Reveal KYC details',
  reveal_bank: 'Reveal bank details',
  upload_document: 'Upload documents',
  delete_document: 'Delete documents',
  post_transaction: 'Post transactions',
  reconcile_transaction: 'Reconcile transactions',
  reverse_transaction: 'Reverse transactions',
  manage_users: 'Manage team members',
  view_audit_log: 'View the audit log',
  manage_periods: 'Manage accounting periods',
  close_period: 'Close accounting periods',
  reopen_period: 'Reopen accounting periods',
  manage_validation_rules: 'Manage validation rules',
  manage_tax_rates: 'Manage tax rates',
  create_journal_voucher: 'Create journal vouchers',
  manage_bank_accounts: 'Manage bank accounts',
  restore_client: 'Restore clients',
  restore_vendor: 'Restore vendors',
  restore_employee: 'Restore employees',
  hard_delete_client: 'Permanently delete clients',
  hard_delete_vendor: 'Permanently delete vendors',
  hard_delete_employee: 'Permanently delete employees',
  hard_delete_document: 'Permanently delete documents',
  hard_delete_custom_field: 'Permanently delete custom fields',
  portal_access: 'Access the employee portal',
  manage_salary_structures: 'Manage salary structures',
  create_salary_run: 'Create salary runs',
  post_salary_run: 'Post salary runs',
  reverse_salary_run: 'Reverse salary runs',
  view_salary: 'View salary details',
  record_bonus_or_perk: 'Record bonuses & perks',
  approve_reimbursement: 'Approve reimbursements',
  approve_leave: 'Approve leave requests',
  manage_leaves: 'Manage leave policies',
  mark_achievement: 'Record achievements',
  manage_user_table_preferences: 'Save personal table views',
  create_invoice: 'Create invoices',
  send_invoice: 'Send invoices',
  void_invoice: 'Void invoices',
  manage_credit_note: 'Manage credit notes',
  manage_estimate: 'Manage estimates',
  receive_payment: 'Receive payments',
  manage_recurring: 'Manage recurring billing & reminders',
  manage_billing_settings: 'Manage billing settings',
  manage_service_items: 'Manage service items',
  manage_party_billing_profile: 'Manage party billing profiles',
  view_gst_reports: 'View GST reports',
  manage_tax_reference_sections: 'Manage TDS/tax reference sections',
  manage_invoice_themes: 'Manage invoice themes',
  manage_company_profile: 'Manage company profile & documents',
  manage_vault: 'Use the credentials vault',
};

/**
 * Roles are a closed enum in code (6 roles, locked) — partner always has
 * every capability and cannot be edited from the matrix UI.
 */
export const ROLES = ['partner', 'admin', 'manager', 'accountant', 'employee', 'viewer'] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  partner: 'Partner',
  admin: 'Admin',
  manager: 'Manager',
  accountant: 'Accountant',
  employee: 'Employee',
  viewer: 'Viewer',
};

/** Grouping for the Settings → Roles matrix UI. Display order, not authz. */
export const CAPABILITY_GROUPS = [
  {
    label: 'Clients',
    capabilities: [
      'create_client',
      'update_client',
      'archive_client',
      'restore_client',
      'hard_delete_client',
    ],
  },
  {
    label: 'Vendors',
    capabilities: [
      'create_vendor',
      'update_vendor',
      'archive_vendor',
      'restore_vendor',
      'hard_delete_vendor',
    ],
  },
  {
    label: 'Employees',
    capabilities: [
      'create_employee',
      'update_employee',
      'archive_employee',
      'restore_employee',
      'hard_delete_employee',
    ],
  },
  {
    label: 'Sensitive reveals',
    capabilities: ['reveal_kyc', 'reveal_bank'],
  },
  {
    label: 'Documents',
    capabilities: ['upload_document', 'delete_document', 'hard_delete_document'],
  },
  {
    label: 'Ledger',
    capabilities: [
      'post_transaction',
      'reconcile_transaction',
      'reverse_transaction',
      'create_journal_voucher',
    ],
  },
  {
    label: 'Period management',
    capabilities: ['manage_periods', 'close_period', 'reopen_period'],
  },
  {
    label: 'Payroll',
    capabilities: [
      'view_salary',
      'manage_salary_structures',
      'create_salary_run',
      'post_salary_run',
      'reverse_salary_run',
      'record_bonus_or_perk',
    ],
  },
  {
    label: 'Approvals & HR',
    capabilities: ['approve_reimbursement', 'approve_leave', 'manage_leaves', 'mark_achievement'],
  },
  {
    label: 'Billing',
    capabilities: [
      'create_invoice',
      'send_invoice',
      'void_invoice',
      'manage_credit_note',
      'manage_estimate',
      'receive_payment',
      'manage_recurring',
      'manage_billing_settings',
      'manage_service_items',
      'manage_party_billing_profile',
      'view_gst_reports',
      'manage_tax_reference_sections',
      'manage_invoice_themes',
    ],
  },
  {
    label: 'Portal & personal',
    capabilities: ['portal_access', 'manage_user_table_preferences'],
  },
  {
    label: 'Administration',
    capabilities: [
      'manage_form_templates',
      'manage_role_capabilities',
      'manage_users',
      'view_audit_log',
      'manage_validation_rules',
      'manage_tax_rates',
      'manage_bank_accounts',
      'hard_delete_custom_field',
      'manage_company_profile',
      'manage_vault',
    ],
  },
] as const satisfies readonly { label: string; capabilities: readonly Capability[] }[];

type GroupedCapability = (typeof CAPABILITY_GROUPS)[number]['capabilities'][number];
type UngroupedCapability = Exclude<Capability, GroupedCapability>;
// Same exhaustiveness trick as CAPABILITY_LABELS: if a capability is added to
// CAPABILITIES but missing from every group above, this assignment fails to
// compile and the error names the missing capability.
const _everyCapabilityGrouped: [UngroupedCapability] extends [never]
  ? true
  : { missingFromCapabilityGroups: UngroupedCapability } = true;
void _everyCapabilityGrouped;
