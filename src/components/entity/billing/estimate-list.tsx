'use client';

import * as React from 'react';

import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

import type { BaseListProps, Estimate, EstimateBulkAction, EstimateFilters } from './types';

export type EstimateListProps = BaseListProps<EstimateFilters, EstimateBulkAction> & {
  estimates: Estimate[];
  defaultVisibleColumns?: string[];
};

/**
 * C1.4 (a) — TanStack DataTable wrapper for estimates.
 *
 * Mirrors InvoiceList: select | document_number | party | document_date |
 * expiry_date | total | state badge | row-actions.
 * Pre-gate stub.
 */
export function EstimateList({ estimates, loading }: EstimateListProps) {
  if (loading) return <Skeleton className="h-72 w-full" />;
  if (estimates.length === 0) {
    return (
      <EmptyState
        title="No estimates yet"
        description="Send your first estimate. Convert to invoice on acceptance."
      />
    );
  }
  return (
    <div className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
      EstimateList placeholder — {estimates.length} estimate
      {estimates.length === 1 ? '' : 's'} loaded.
    </div>
  );
}
