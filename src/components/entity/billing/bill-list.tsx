'use client';

import * as React from 'react';

import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

import type { BaseListProps, Bill, BillBulkAction, BillFilters } from './types';

export type BillListProps = BaseListProps<BillFilters, BillBulkAction> & {
  bills: Bill[];
  defaultVisibleColumns?: string[];
};

/**
 * C1.6 (a) — TanStack DataTable for vendor bills.
 * Columns: select | vendor_document_number | party (vendor) | attribution badge |
 *          on_behalf_of_client (if any) | document_date | due_date | total |
 *          paid | balance | state badge | row-actions.
 * Pre-gate stub.
 */
export function BillList({ bills, loading }: BillListProps) {
  if (loading) return <Skeleton className="h-72 w-full" />;
  if (bills.length === 0) {
    return (
      <EmptyState
        title="No vendor bills yet"
        description="Record a bill so it lands in your AP ledger."
      />
    );
  }
  return (
    <div className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
      BillList placeholder — {bills.length} bill{bills.length === 1 ? '' : 's'} loaded.
    </div>
  );
}
