import 'server-only';

import {
  CAPABILITIES,
  CAPABILITY_SET,
  type Capability,
  type Role,
} from './capabilities';
import { AppError } from './errors';
import type { SupabaseServerClient } from './supabase/server';

/**
 * Server-side RBAC gating. The capability/role enums and labels live in the
 * client-safe `./capabilities` module (the roles matrix UI renders from the
 * same source of truth); they are re-exported here so server code keeps
 * importing everything from '@/lib/rbac'.
 */
export {
  CAPABILITIES,
  CAPABILITY_LABELS,
  CAPABILITY_SET,
  ROLES,
  ROLE_LABELS,
} from './capabilities';
export type { Capability, Role } from './capabilities';

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
    'manage_invoice_themes',
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
