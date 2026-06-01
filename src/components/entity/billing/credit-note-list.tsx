'use client';

import * as React from 'react';

import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

import type { BaseListProps, CreditNote, CreditNoteBulkAction, CreditNoteFilters } from './types';

export type CreditNoteListProps = BaseListProps<CreditNoteFilters, CreditNoteBulkAction> & {
  creditNotes: CreditNote[];
  defaultVisibleColumns?: string[];
};

/**
 * C1.5 (a) — TanStack DataTable for credit notes.
 * Columns: select | document_number | party | document_date | original_invoice |
 *          total | state badge | gst_impact pill | row-actions.
 * Pre-gate stub.
 */
export function CreditNoteList({ creditNotes, loading }: CreditNoteListProps) {
  if (loading) return <Skeleton className="h-72 w-full" />;
  if (creditNotes.length === 0) {
    return (
      <EmptyState
        title="No credit notes yet"
        description="Credit notes adjust or reverse invoices; create one from an invoice page."
      />
    );
  }
  return (
    <div className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
      CreditNoteList placeholder — {creditNotes.length} credit note
      {creditNotes.length === 1 ? '' : 's'} loaded.
    </div>
  );
}
