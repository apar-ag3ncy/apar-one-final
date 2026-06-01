'use client';

import * as React from 'react';

import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

import type { AgingBucketMode, ArAgingRow, NavigationTarget } from './types';

export type ArAgingTableProps = {
  rows: ArAgingRow[];
  loading?: boolean;
  bucketMode: AgingBucketMode;
  onBucketModeChange: (mode: AgingBucketMode) => void;
  /** Click a party row → open the party's statement-of-account. */
  onNavigate?: (target: NavigationTarget) => void;
  /** Click a bucket cell → drill into that bucket's invoices for the party. */
  onBucketDrill?: (
    partyId: string,
    bucket: 'current' | '1_30' | '31_60' | '61_90' | '90_plus',
  ) => void;
};

/**
 * C1.8 — AR aging table.
 *
 * Columns: party (EntityRef) | current | 1-30 | 31-60 | 61-90 | 90+ | total.
 * Toggle in the header switches the bucket mode (due-date vs invoice-date).
 * Money formatted via formatINR; click any cell to drill (host handles).
 *
 * Pre-gate stub.
 */
export function ArAgingTable({ rows, loading }: ArAgingTableProps) {
  if (loading) return <Skeleton className="h-72 w-full" />;
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No outstanding receivables"
        description="When you have unpaid invoices, they'll appear here bucketed by age."
      />
    );
  }
  return (
    <div className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
      ArAgingTable placeholder — {rows.length} part{rows.length === 1 ? 'y' : 'ies'} with balance.
    </div>
  );
}
