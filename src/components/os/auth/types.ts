// Auth + RBAC types for the Apar One demo.
//
// Demo-grade: no real password hashing, no JWT, no server. Production will
// route through Supabase Auth + Postgres RLS — see CLAUDE.md. The shape here
// is what those backend pieces will eventually emit.

import type { AppId } from '../types';

export type Role = 'super_admin' | 'admin' | 'user';

export type AppPermission = {
  view: boolean;
  edit: boolean;
  delete: boolean;
};

// One entry per permissioned app. `admin_console` and `settings` are special:
// `admin_console` is super-admin-only and ignores this map; `settings` is
// always view-only available to everyone signed in.
export type Permissions = Record<AppId, AppPermission>;

export type User = {
  id: string;
  username: string;
  fullName: string;
  /**
   * Demo placeholder for the real credential. We deliberately call this
   * `password` (not `passwordHash`) so nobody mistakes it for production-grade
   * storage. Production swaps this whole module for Supabase Auth.
   */
  password: string;
  role: Role;
  /** Avatar background colour. */
  tone: string;
  permissions: Permissions;
  createdAt: string;
};

/** App ids that participate in RBAC (everything except the super-admin-only Admin Console). */
export const PERMISSIONED_APPS: readonly Exclude<AppId, 'admin_console'>[] = [
  'clients',
  'vendors',
  'projects',
  'employees',
  'attendance',
  'ledger',
  'reports',
  'office',
  'settings',
] as const;

/** All-false permission map — used when creating a new admin until perms are set. */
export function emptyPermissions(): Permissions {
  const base: Partial<Permissions> = {};
  for (const id of PERMISSIONED_APPS) {
    base[id] = { view: false, edit: false, delete: false };
  }
  // Super-admin-only app — never granted via this map.
  base.admin_console = { view: false, edit: false, delete: false };
  return base as Permissions;
}

/** Full-access map — used for the super admin and as a "Grant all" preset. */
export function fullPermissions(): Permissions {
  const base: Partial<Permissions> = {};
  for (const id of PERMISSIONED_APPS) {
    base[id] = { view: true, edit: true, delete: true };
  }
  base.admin_console = { view: true, edit: true, delete: true };
  return base as Permissions;
}

/**
 * Permission check for an arbitrary user. Super admin bypasses the map entirely
 * so a corrupt localStorage can't lock them out.
 */
export function can(user: User, appId: AppId, action: keyof AppPermission): boolean {
  if (user.role === 'super_admin') return true;
  if (appId === 'admin_console') return false; // hard rule: only super admin sees Admin Console
  return user.permissions[appId]?.[action] ?? false;
}
