'use client';

import * as React from 'react';

import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

import type { BaseListProps, Receipt, ReceiptBulkAction, ReceiptFilters } from './types';

export type ReceiptListProps = BaseListProps<ReceiptFilters, ReceiptBulkAction> & {
  receipts: Receipt[];
  defaultVisibleColumns?: string[];
};

/**
 * C1.7 (a) — TanStack DataTable for client receipts.
 * Columns: select | document_number | party | receipt_date | method badge |
 *          amount | tds | allocated/unallocated | state badge | row-actions.
 * Pre-gate stub.
 */
export function ReceiptList({ receipts, loading }: ReceiptListProps) {
  if (loading) return <Skeleton className="h-72 w-full" />;
  if (receipts.length === 0) {
    return (
      <EmptyState
        title="No receipts yet"
        description="Record an incoming payment to start reconciling against invoices."
      />
    );
  }
  return (
    <div className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
      ReceiptList placeholder — {receipts.length} receipt
      {receipts.length === 1 ? '' : 's'} loaded.
    </div>
  );
}
