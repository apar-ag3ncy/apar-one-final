// Shared OS-side navigation glue. Every `<EntityRef onNavigate={…}>`
// callback in a Phase-4 window funnels through here so the mapping from
// B's `NavigationTarget.type` to the OS's `AppId` lives in exactly one
// place. Dashboard's equivalent maps the same target to a route.

import { osActions } from '@/lib/os/store';
import type { NavigationTarget } from '@/components/entity/types';
import type { AppId } from '../types';

export function entityTypeToAppId(t: NavigationTarget['type']): AppId | null {
  switch (t) {
    case 'client':
      return 'clients';
    case 'vendor':
      return 'vendors';
    case 'project':
      return 'projects';
    case 'employee':
      return 'employees';
    case 'transaction':
      return 'transactions';
    case 'document':
      return 'documents';
    default:
      return null;
  }
}

/**
 * `onNavigate` callback for shared entity components inside OS windows.
 * Always opens the target beside the focused window — the multi-window
 * superpower called out in the brief.
 */
export function navigateBesideFocused(target: NavigationTarget): void {
  const app = entityTypeToAppId(target.type);
  if (!app) return;
  osActions.openWindow({
    app,
    entityId: target.id,
    tab: target.tab,
    position: 'beside-focused',
  });
}
