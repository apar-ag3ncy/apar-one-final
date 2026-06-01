'use client';

// Capability gating for the OS dock + Cmd+K palette.
//
// Spec source: SESSION-C-OS-BROWNFIELD §Phase 2.4 + SPEC-AMENDMENT-001 §8.2
// (employees do NOT get the OS) + FRONTEND-OS-AUDIT §3.3 (RBAC swap).
//
// Each registered app declares the *minimum capability* a user needs to
// see it in the dock. Hide (don't disable) when the user lacks it.
//
// During the brownfield phase the OS still ships its own
// `auth/types.ts` capability model (`{ view, edit, delete }` per app id).
// This registry is the staging ground for the 6-role + closed-capability-
// enum model that lands once Backend ships `role_capabilities`. Adapt by
// swapping the `minimumCapability` strings; consumers don't change.

import type { AppId } from '@/components/os/types';

/**
 * Coarse capability ids consumed by the dock. Resolved by the OS shell's
 * `hasCapability(user, capability)` helper to either:
 *   - the legacy `can(user, app, action)` matrix (Phase 1)
 *   - the new `role_capabilities` row lookup (Phase 2.6 / post-auth swap)
 */
export type AppCapability =
  | 'app.clients.view'
  | 'app.vendors.view'
  | 'app.projects.view'
  | 'app.employees.view'
  | 'app.attendance.view'
  | 'app.inbox.view'
  | 'app.ledger.view'
  | 'app.reports.view'
  | 'app.office.view'
  | 'app.settings.view'
  | 'app.admin_console.view';

export type AppRegistryEntry = {
  id: AppId;
  /** Visible in the OS dock at all? (Phase 4 might add some that are launched only via deep-link.) */
  showInDock: boolean;
  /** Capability required to see this app's dock icon and launch it. */
  minimumCapability: AppCapability;
  /** Default window dimensions for a fresh open. */
  defaultSize: { width: number; height: number };
};

export const APP_REGISTRY: Readonly<Record<AppId, AppRegistryEntry>> = {
  clients: {
    id: 'clients',
    showInDock: true,
    minimumCapability: 'app.clients.view',
    defaultSize: { width: 880, height: 580 },
  },
  vendors: {
    id: 'vendors',
    showInDock: true,
    minimumCapability: 'app.vendors.view',
    defaultSize: { width: 880, height: 560 },
  },
  projects: {
    id: 'projects',
    showInDock: true,
    minimumCapability: 'app.projects.view',
    defaultSize: { width: 1080, height: 620 },
  },
  employees: {
    id: 'employees',
    showInDock: true,
    minimumCapability: 'app.employees.view',
    defaultSize: { width: 880, height: 560 },
  },
  attendance: {
    id: 'attendance',
    showInDock: true,
    minimumCapability: 'app.attendance.view',
    defaultSize: { width: 1180, height: 720 },
  },
  inbox: {
    id: 'inbox',
    showInDock: true,
    minimumCapability: 'app.inbox.view',
    defaultSize: { width: 820, height: 560 },
  },
  ledger: {
    id: 'ledger',
    showInDock: true,
    minimumCapability: 'app.ledger.view',
    defaultSize: { width: 1100, height: 680 },
  },
  reports: {
    id: 'reports',
    showInDock: true,
    minimumCapability: 'app.reports.view',
    defaultSize: { width: 1000, height: 620 },
  },
  office: {
    id: 'office',
    showInDock: true,
    minimumCapability: 'app.office.view',
    defaultSize: { width: 1100, height: 700 },
  },
  settings: {
    id: 'settings',
    showInDock: true,
    minimumCapability: 'app.settings.view',
    defaultSize: { width: 880, height: 600 },
  },
  admin_console: {
    id: 'admin_console',
    showInDock: true,
    minimumCapability: 'app.admin_console.view',
    defaultSize: { width: 980, height: 620 },
  },
  // Phase 4 windows — never in the dock. They open via beside-focused from
  // the ledger / entity-profile / document-list surfaces.
  transactions: {
    id: 'transactions',
    showInDock: false,
    minimumCapability: 'app.ledger.view',
    defaultSize: { width: 920, height: 720 },
  },
  documents: {
    id: 'documents',
    showInDock: false,
    minimumCapability: 'app.inbox.view', // Documents are a side of inbox/extraction
    defaultSize: { width: 800, height: 1000 }, // 4:5 portrait per amendment §10.2
  },
  bank_recon: {
    id: 'bank_recon',
    showInDock: false,
    minimumCapability: 'app.ledger.view',
    defaultSize: { width: 1200, height: 800 }, // Wide for two-pane match UX
  },
};

/**
 * Apps that should hide from the dock for *every* role of a portal-only
 * user. Today that's just `role='employee'` per amendment §8.2. The
 * employee experience lives in B's `app/(portal)/me` Dashboard route,
 * not in the OS. When the real Supabase Auth role string is available,
 * `(os)/layout.tsx` redirects employees to `/me`; until then this set
 * is consulted as a belt-and-braces hide for the dock.
 */
export const HIDDEN_FOR_PORTAL_ROLES: ReadonlySet<AppId> = new Set();
// All apps are hidden when the user is a portal-only role; the dock
// renders nothing. Kept as a Set for symmetry with future per-role
// exclusions (e.g. interns who get clients but not ledger).

/**
 * Roles whose users never see the OS. Mirrored against the
 * `auth.users.role` string. Until RBAC swaps to Supabase Auth + the
 * six-role enum, the OS only emits legacy roles (super_admin/admin/user)
 * and this set is effectively empty.
 */
export const PORTAL_ONLY_ROLES: ReadonlySet<string> = new Set(['employee']);

export function isPortalOnlyRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return PORTAL_ONLY_ROLES.has(role);
}
