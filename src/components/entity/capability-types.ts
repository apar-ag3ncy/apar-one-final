/**
 * Capability and role definitions per AUDIT-GAPS §3 + SPEC-AMENDMENT-001.
 *
 * Roles are a closed enum in code (6 roles, locked) — partner always has
 * every capability and cannot be edited. Capabilities are also a closed
 * enum; the matrix UI lets a partner grant/revoke each role × capability
 * cell except partner's row.
 *
 * Backend (Session A) replaces this with a generated module once the
 * `role_capabilities` table lands. Until then this is the authoritative
 * frontend list — keep it in sync with the brief.
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

/**
 * Capability codes. Used by both the matrix UI and by entity components
 * that gate affordances (e.g. BankAccountList's "Reveal" button hides
 * unless `reveal_bank` is granted).
 */
export const CAPABILITIES = [
  // Entity lifecycle
  'create_client',
  'edit_client',
  'archive_client',
  'create_vendor',
  'edit_vendor',
  'archive_vendor',
  'create_employee',
  'edit_employee',
  'archive_employee',
  'create_project',
  'edit_project',

  // Sensitive reveals (every reveal audit-logged)
  'reveal_bank',
  'reveal_kyc',

  // Documents
  'upload_document',
  'delete_document',

  // Ledger
  'create_draft_transaction',
  'post_transaction',
  'reverse_transaction',
  'post_journal_voucher',
  'soft_close_period',
  'hard_close_period',
  'reopen_period',

  // Approvals
  'approve_reimbursement',
  'approve_leave',
  'approve_salary_run',

  // Admin
  'manage_form_templates',
  'manage_capabilities',
  'manage_validation_rules',
  'manage_tax_reference_rates',
  'manage_agency_bank_accounts',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  create_client: 'Create client',
  edit_client: 'Edit client',
  archive_client: 'Archive client',
  create_vendor: 'Create vendor',
  edit_vendor: 'Edit vendor',
  archive_vendor: 'Archive vendor',
  create_employee: 'Create employee',
  edit_employee: 'Edit employee',
  archive_employee: 'Archive employee',
  create_project: 'Create project',
  edit_project: 'Edit project',
  reveal_bank: 'Reveal bank number',
  reveal_kyc: 'Reveal KYC (PAN / Aadhaar)',
  upload_document: 'Upload document',
  delete_document: 'Delete document',
  create_draft_transaction: 'Create draft transaction',
  post_transaction: 'Post transaction',
  reverse_transaction: 'Reverse transaction',
  post_journal_voucher: 'Post journal voucher',
  soft_close_period: 'Soft-close period',
  hard_close_period: 'Hard-close period',
  reopen_period: 'Re-open closed period',
  approve_reimbursement: 'Approve reimbursement',
  approve_leave: 'Approve leave',
  approve_salary_run: 'Approve salary run',
  manage_form_templates: 'Manage Form Builder',
  manage_capabilities: 'Manage role capabilities',
  manage_validation_rules: 'Manage validation rules',
  manage_tax_reference_rates: 'Manage tax reference rates',
  manage_agency_bank_accounts: 'Manage agency bank accounts',
};

/** Grouping for the matrix UI. */
export const CAPABILITY_GROUPS: { label: string; capabilities: readonly Capability[] }[] = [
  {
    label: 'Clients',
    capabilities: ['create_client', 'edit_client', 'archive_client'],
  },
  {
    label: 'Vendors',
    capabilities: ['create_vendor', 'edit_vendor', 'archive_vendor'],
  },
  {
    label: 'Employees',
    capabilities: ['create_employee', 'edit_employee', 'archive_employee'],
  },
  {
    label: 'Projects',
    capabilities: ['create_project', 'edit_project'],
  },
  {
    label: 'Sensitive reveals',
    capabilities: ['reveal_bank', 'reveal_kyc'],
  },
  {
    label: 'Documents',
    capabilities: ['upload_document', 'delete_document'],
  },
  {
    label: 'Ledger',
    capabilities: [
      'create_draft_transaction',
      'post_transaction',
      'reverse_transaction',
      'post_journal_voucher',
    ],
  },
  {
    label: 'Period management',
    capabilities: ['soft_close_period', 'hard_close_period', 'reopen_period'],
  },
  {
    label: 'Approvals',
    capabilities: ['approve_reimbursement', 'approve_leave', 'approve_salary_run'],
  },
  {
    label: 'Administration',
    capabilities: [
      'manage_form_templates',
      'manage_capabilities',
      'manage_validation_rules',
      'manage_tax_reference_rates',
      'manage_agency_bank_accounts',
    ],
  },
];

/** Default grants — what each role starts with on a fresh install. */
export const DEFAULT_GRANTS: Record<Role, ReadonlySet<Capability>> = {
  partner: new Set(CAPABILITIES), // every capability, always
  admin: new Set([
    'create_client',
    'edit_client',
    'archive_client',
    'create_vendor',
    'edit_vendor',
    'archive_vendor',
    'create_employee',
    'edit_employee',
    'archive_employee',
    'create_project',
    'edit_project',
    'reveal_bank',
    'upload_document',
    'delete_document',
    'create_draft_transaction',
    'post_transaction',
    'reverse_transaction',
    'soft_close_period',
    'approve_reimbursement',
    'approve_leave',
    'manage_form_templates',
  ]),
  manager: new Set([
    'edit_client',
    'edit_vendor',
    'edit_project',
    'create_project',
    'upload_document',
    'create_draft_transaction',
    'approve_reimbursement',
    'approve_leave',
  ]),
  accountant: new Set([
    'create_vendor',
    'edit_vendor',
    'upload_document',
    'create_draft_transaction',
    'post_transaction',
    'reverse_transaction',
    'post_journal_voucher',
    'soft_close_period',
    'approve_reimbursement',
    'manage_tax_reference_rates',
  ]),
  employee: new Set(['upload_document']),
  viewer: new Set([]),
};
