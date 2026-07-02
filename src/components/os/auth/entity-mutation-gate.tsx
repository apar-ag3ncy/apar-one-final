'use client';

// OS read-only gate for entity detail windows.
//
// The OS demo permission model (`auth/types.ts` → `can(user, app, action)`)
// is enforced in the OS shell (dock, command palette, `openApp`, and the
// list apps). But the entity *detail* windows (ClientWindow, VendorWindow,
// EmployeeWindow, ProjectWindow) render shared `components/entity/*` sections
// whose own gating reads the real server RBAC via `useCurrentUser()` — which,
// under the OS's dev-admin fallback, reports every capability as granted. So
// without this bridge a view-only OS user would see full add / edit / delete
// UI inside a detail window even though the operator never granted it.
//
// This context carries the OS user's edit/delete grant for the entity on
// screen. Shared sections read it via `useEntityMutation()` and hide their
// mutation affordances when denied. The default is PERMISSIVE so the real
// `(app)` surface — which has no provider and relies on server-side
// `requireCapability` enforcement — is completely unchanged.

import { createContext, useContext, useMemo, type ReactNode } from 'react';

export type EntityMutationAccess = {
  /** May the user create / edit records in this detail window? */
  canEdit: boolean;
  /** May the user delete / archive records in this detail window? */
  canDelete: boolean;
};

const PERMISSIVE: EntityMutationAccess = { canEdit: true, canDelete: true };

const EntityMutationContext = createContext<EntityMutationAccess>(PERMISSIVE);

export function EntityMutationGate({
  canEdit,
  canDelete,
  children,
}: {
  canEdit: boolean;
  canDelete: boolean;
  children: ReactNode;
}) {
  const value = useMemo<EntityMutationAccess>(() => ({ canEdit, canDelete }), [canEdit, canDelete]);
  return <EntityMutationContext.Provider value={value}>{children}</EntityMutationContext.Provider>;
}

/**
 * Read the current entity-mutation grant. Defaults to fully permissive when
 * no `EntityMutationGate` is above it in the tree (i.e. the real `(app)`
 * surface), so this hook only ever *tightens* access inside the OS.
 */
export function useEntityMutation(): EntityMutationAccess {
  return useContext(EntityMutationContext);
}
