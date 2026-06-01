'use client';

import { useEffect, useState } from 'react';
import { AlertTriangleIcon } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';

export type LazyTabProps<T> = {
  /** Function that fetches the tab's data. Called once on mount. */
  load: () => Promise<T>;
  /** Render-prop: receives the loaded data. */
  children: (data: T) => React.ReactNode;
  /** Optional custom skeleton. Defaults to three Skeleton blocks. */
  fallback?: React.ReactNode;
};

/**
 * Per SPEC-AMENDMENT-001 §4.1 + AUDIT-GAPS §4.1 — entity-profile tabs are
 * lazy-loaded so the Overview render does not pay for every tab's fetch.
 *
 * Because Radix's `<TabsContent>` does NOT mount its children when the
 * tab is inactive, a tab component's body (including its useEffect-based
 * fetch) only runs the first time the user opens that tab. This wrapper
 * just gives a uniform loading/error UX.
 *
 * Returns the children render-prop result once `load()` resolves.
 */
export function LazyTab<T>({ load, children, fallback }: LazyTabProps<T>) {
  type State =
    | { kind: 'loading' }
    | { kind: 'ready'; data: T }
    | { kind: 'error'; message: string };
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (!cancelled) setState({ kind: 'ready', data });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: e instanceof Error ? e.message : 'Failed to load',
        });
      });
    return () => {
      cancelled = true;
    };
    // load() is deliberately not in deps — the tab's data is bound to the
    // parent's entityId via closure and we only want one fetch per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.kind === 'loading') {
    return (
      <>
        {fallback ?? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
      </>
    );
  }

  if (state.kind === 'error') {
    return (
      <EmptyState
        icon={AlertTriangleIcon}
        title="Could not load this tab"
        description={state.message}
      />
    );
  }

  return <>{children(state.data)}</>;
}
