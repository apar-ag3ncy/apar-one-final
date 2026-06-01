'use client';

import * as React from 'react';

import { Skeleton } from '@/components/ui/skeleton';

import type { CreditNote, NavigationTarget } from './types';

export type CreditNoteDetailProps = {
  creditNote: CreditNote | null;
  loading?: boolean;
  onNavigate?: (target: NavigationTarget) => void;
  onVoidClick?: (creditNoteId: string) => void;
  onApplyClick?: (creditNoteId: string) => void;
  documentViewerSlot?: React.ReactNode;
};

/**
 * C1.5 (b) — Read-only credit note view.
 *
 * Same layout as InvoiceDetail plus:
 *   - Prominent link back to original_invoice (EntityRef)
 *   - GST impact banner: green if within §34(2) window, amber outside
 * Pre-gate stub.
 */
export function CreditNoteDetail({ creditNote, loading }: CreditNoteDetailProps) {
  if (loading || !creditNote) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="text-muted-foreground rounded-md border border-dashed p-8 text-sm">
      CreditNoteDetail placeholder — {creditNote.document_number}
    </div>
  );
}
