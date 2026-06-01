'use client';

import * as React from 'react';

import { Skeleton } from '@/components/ui/skeleton';

import type { Bill, NavigationTarget } from './types';

export type BillDetailProps = {
  bill: Bill | null;
  loading?: boolean;
  onNavigate?: (target: NavigationTarget) => void;
  onMarkPaidClick?: (billId: string) => void;
  onVoidClick?: (billId: string) => void;
  /** Reverse posts a reversing transaction; only available for posted state. */
  onReverseClick?: (billId: string) => void;
  documentViewerSlot?: React.ReactNode;
};

/**
 * C1.6 (b) — Read-only vendor bill view.
 *
 * Header includes prominent attribution badge (client / opex / asset) and the
 * client / project EntityRefs when applicable. TDS section + amount and the
 * captured GST split panel are surfaced explicitly. Pre-gate stub.
 */
export function BillDetail({ bill, loading }: BillDetailProps) {
  if (loading || !bill) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="text-muted-foreground rounded-md border border-dashed p-8 text-sm">
      BillDetail placeholder — {bill.document_number} ({bill.attribution})
    </div>
  );
}
