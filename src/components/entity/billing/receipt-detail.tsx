'use client';

import * as React from 'react';

import { Skeleton } from '@/components/ui/skeleton';

import type { NavigationTarget, Receipt } from './types';

export type ReceiptDetailProps = {
  receipt: Receipt | null;
  loading?: boolean;
  onNavigate?: (target: NavigationTarget) => void;
  onVoidClick?: (receiptId: string) => void;
  /** Re-open the allocation editor; only meaningful while unallocated > 0. */
  onEditAllocationsClick?: (receiptId: string) => void;
  documentViewerSlot?: React.ReactNode;
};

/**
 * C1.7 (b) — Read-only receipt view.
 *
 * Header: party EntityRef, document_number, receipt_date, state, method.
 * If method='razorpay', show the payment_link_id with a small "matched via
 * webhook" indicator. Allocations table at the bottom mirrors the form view.
 * Pre-gate stub.
 */
export function ReceiptDetail({ receipt, loading }: ReceiptDetailProps) {
  if (loading || !receipt) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="text-muted-foreground rounded-md border border-dashed p-8 text-sm">
      ReceiptDetail placeholder — {receipt.document_number}
    </div>
  );
}
