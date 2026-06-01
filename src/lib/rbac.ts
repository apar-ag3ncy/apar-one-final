import 'server-only';

import { AppError } from './errors';
import type { SupabaseServerClient } from './supabase/server';

/**
 * Closed enum of capability strings. Adding a capability requires a code
 * change here AND a row in `role_capabilities` (seeded by
 * 0006_seed_role_capabilities.sql). AUDIT-GAPS §3: "Capabilities are a
 * closed enum in code, not free text. Otherwise you've built a second
 * permission system on top of the first."
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
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_SET: ReadonlySet<Capability> = new Set(CAPABILITIES);

export type Role = 'partner' | 'admin' | 'manager' | 'accountant' | 'employee' | 'viewer';

/**
 * Default role × capability grants for the v1 seed (matches the brief's
 * Phase 3 explicit list + SPEC-AMENDMENT-001 §11 assignments).
 *
 * Partner is intentionally NOT listed here; the seed migration grants
 * partner ALL capabilities and `hasCapability` / `requireCapability`
 * short-circuit for partners. Partner cannot be edited from the UI.
 *
 * Manager scope: create/update entities + upload docs. NOT view_salary
 * (managers see salary_runs headers only, not lines — SPEC-AMENDMENT-001
 * §11 confirmed-default #7).
 */
export const DEFAULT_GRANTS: Record<Exclude<Role, 'partner'>, readonly Capability[]> = {
  admin: CAPABILITIES.filter((c) => c !== 'manage_role_capabilities' && c !== 'reopen_period'),
  accountant: [
    'reveal_bank',
    'post_transaction',
    'reconcile_transaction',
    'reverse_transaction',
    'upload_document',
    'view_audit_log',
    'manage_validation_rules',
    'manage_tax_rates',
    'manage_bank_accounts',
    'view_salary',
    'manage_salary_structures',
    'create_salary_run',
    'post_salary_run',
    'reverse_salary_run',
    'record_bonus_or_perk',
    'approve_reimbursement',
    'manage_user_table_preferences',
    // Billing — accountant runs day-to-day billing ops, but NOT settings /
    // tax-section editing (those are admin-tier).
    'create_invoice',
    'send_invoice',
    'void_invoice',
    'manage_credit_note',
    'manage_estimate',
    'receive_payment',
    'manage_recurring',
    'manage_service_items',
    'manage_party_billing_profile',
    'view_gst_reports',
  ],
  manager: [
    'create_client',
    'update_client',
    'create_vendor',
    'update_vendor',
    'create_employee',
    'update_employee',
    'upload_document',
    'approve_reimbursement', // for direct reports only; RLS handles scope
    'approve_leave',
    'manage_user_table_preferences',
    // Billing — managers can compose invoices + estimates for their clients
    // but cannot void, issue credit notes, or touch payments.
    'create_invoice',
    'send_invoice',
    'manage_estimate',
  ],
  employee: ['upload_document', 'portal_access', 'manage_user_table_preferences'],
  viewer: ['manage_user_table_preferences'],
};

export type CurrentUserContext = {
  userId: string;
  role: Role;
  /** Resolved capability set — never re-read from the DB inside a request. */
  capabilities: ReadonlySet<Capability>;
};

/**
 * Throws AppError('forbidden') if the user lacks the capability. Partners
 * pass through. The `kind` defaults to 'forbidden' but ledger / KYC
 * helpers pass their own narrower kind for better error UX.
 */
export function requireCapability(
  ctx: CurrentUserContext,
  cap: Capability,
  message?: string,
): void {
  if (ctx.role === 'partner') return;
  if (!CAPABILITY_SET.has(cap)) {
    throw new AppError(
      'internal',
      `requireCapability: unknown capability "${cap}". Did you forget to add it to CAPABILITIES?`,
    );
  }
  if (!ctx.capabilities.has(cap)) {
    throw new AppError('forbidden', message ?? `Missing capability: ${cap}`, {
      detail: { capability: cap, role: ctx.role },
    });
  }
}

export function hasCapability(ctx: CurrentUserContext, cap: Capability): boolean {
  if (ctx.role === 'partner') return true;
  return ctx.capabilities.has(cap);
}

/**
 * Loads a user's effective capability set from `role_capabilities`. Cached
 * per request — call once at the request boundary in `lib/auth.ts:currentUser`.
 */
export async function loadCapabilities(
  client: SupabaseServerClient,
  role: Role,
): Promise<ReadonlySet<Capability>> {
  if (role === 'partner') {
    return CAPABILITY_SET;
  }
  const { data, error } = await client
    .from('role_capabilities')
    .select('capability,granted')
    .eq('role', role);
  if (error) {
    throw new AppError('internal', 'Failed to load role capabilities', {
      cause: error,
    });
  }
  const granted = new Set<Capability>();
  for (const row of data ?? []) {
    if (row.granted && CAPABILITY_SET.has(row.capability as Capability)) {
      granted.add(row.capability as Capability);
    }
  }
  return granted;
}
