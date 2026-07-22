// Auth + RBAC types for the Apar One demo.
//
// Demo-grade: no real password hashing, no JWT, no server. Production will
// route through Supabase Auth + Postgres RLS — see CLAUDE.md. The shape here
// is what those backend pieces will eventually emit.

import type { AppId } from '../types';

export type Role = 'super_admin' | 'admin' | 'user' | 'employee';

/**
 * The only apps a role='employee' session may ever see. `can()` hard-whitelists
 * exactly these (view-only) for that role and denies everything else — the
 * client-side half of the employee/accounting boundary (the server-side half is
 * getActorContext() denying employee sessions in src/lib/server/actor.ts).
 */
export const EMPLOYEE_APP_IDS: ReadonlySet<AppId> = new Set<AppId>([
  'my_tasks',
  'my_team',
  'my_attendance',
  'my_leaves',
]);

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
   * Legacy field — passwords now live server-side (scrypt-hashed in the
   * `os_users` table) and are never sent to the client, so this is only ever
   * present transiently in edit forms. Kept optional so the identity-card
   * `Pick<User, 'password'>` patch types keep working.
   */
  password?: string;
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
  'dashboard',
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
  // Employees are confined to a fixed, view-only whitelist of employee apps —
  // no map, no exceptions. Never any accounting/admin/settings surface.
  if (user.role === 'employee') return EMPLOYEE_APP_IDS.has(appId) && action === 'view';
  if (appId === 'admin_console') return false; // hard rule: only super admin sees Admin Console
  // 'accounts' is a launcher shell (Clients / Vendors / Ledgers / Reports
  // live inside it) — it has no permission row of its own; it is usable
  // whenever any member app is. Real access checks stay per member app.
  if (appId === 'accounts') {
    return (['clients', 'vendors', 'ledger', 'reports'] as const).some((id) =>
      can(user, id, action),
    );
  }
  // 'office' doubles as a launcher shell (Expenses / Projects / Team /
  // Attendance live inside it). Opening the launcher only needs view on any
  // member; the Expenses tracker itself still gates on the office row, which
  // call sites read directly (`user.permissions.office`).
  if (appId === 'office' && action === 'view') {
    return (
      (user.permissions.office?.view ?? false) ||
      (['projects', 'employees', 'attendance'] as const).some((id) => can(user, id, 'view'))
    );
  }
  // Trash is the recovery/disposal surface — mirrors the old Settings ▸ Trash
  // gate (settings edit). Server actions additionally restrict permanent
  // deletes to admins/partners.
  if (appId === 'trash') {
    return user.permissions.settings?.edit ?? false;
  }
  return user.permissions[appId]?.[action] ?? false;
}
