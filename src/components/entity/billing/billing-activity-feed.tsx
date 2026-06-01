'use client';

import * as React from 'react';

import { Skeleton } from '@/components/ui/skeleton';

import type { BillingActivityKind, NavigationTarget } from './types';

/**
 * Activity row shape — the host pulls these from the existing
 * `entity_activity_log` table via the existing `useRealtimeActivity` hook,
 * filtered down to billing event kinds. We don't subscribe directly inside
 * this component (dumb-component rule).
 */
export type BillingActivityItem = {
  id: string;
  kind: BillingActivityKind;
  summary: string;
  actor_label: string;
  actor_avatar_url?: string | null;
  created_at: string; // ISO timestamp
  /** Click → navigate to the document this row is about. */
  navigate_target?: NavigationTarget | null;
};

export type BillingActivityFeedProps = {
  items: BillingActivityItem[];
  loading?: boolean;
  /** True when the realtime subscription is connected; false → polling fallback. */
  realtimeConnected?: boolean;
  onNavigate?: (target: NavigationTarget) => void;
  /**
   * Filter chips at the top: 'all' | 'invoices' | 'estimates' | 'credit_notes'
   * | 'bills' | 'payments'. Controlled — host owns the state.
   */
  filter?: 'all' | 'invoices' | 'estimates' | 'credit_notes' | 'bills' | 'payments';
  onFilterChange?: (filter: NonNullable<BillingActivityFeedProps['filter']>) => void;
  /** Infinite-scroll: host loads next page. */
  onLoadMore?: () => void;
  hasMore?: boolean;
};

/**
 * C1.11 — Reverse-chronological feed of billing-related activity, grouped by
 * day. Consumes a filtered slice of `entity_activity_log` (the host wraps the
 * existing `useRealtimeActivity` hook and passes results through).
 *
 * Pre-gate stub.
 */
export function BillingActivityFeed({ items, loading }: BillingActivityFeedProps) {
  if (loading) return <Skeleton className="h-96 w-full" />;
  if (items.length === 0) {
    return (
      <div className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
        No recent billing activity. Send an invoice or record a payment to see events appear here in
        real time.
      </div>
    );
  }
  return (
    <div className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
      BillingActivityFeed placeholder — {items.length} event{items.length === 1 ? '' : 's'} loaded.
    </div>
  );
}
