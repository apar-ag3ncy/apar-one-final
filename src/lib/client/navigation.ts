import type { NavigationTarget } from '@/components/entity/types';

/**
 * Dashboard-side translation of a surface-agnostic NavigationTarget to a
 * route path under `app/(app)/`.
 *
 * OS does NOT use this — `components/os/...` translates the same target
 * into a window-open action via its own store. That separation is the whole
 * point of the `onNavigate` callback prop on shared entity components.
 */
export function targetToUrl(target: NavigationTarget): string {
  const base = (() => {
    switch (target.type) {
      case 'client':
        return `/clients/${target.id}`;
      case 'vendor':
        return `/vendors/${target.id}`;
      case 'employee':
        return `/employees/${target.id}`;
      case 'project':
        return `/projects/${target.id}`;
      case 'transaction':
        return `/ledger/${target.id}`;
      case 'document':
        return `/documents/${target.id}`;
    }
  })();
  return target.tab ? `${base}?tab=${encodeURIComponent(target.tab)}` : base;
}
