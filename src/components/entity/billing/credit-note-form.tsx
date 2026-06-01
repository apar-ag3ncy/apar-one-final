'use client';

import * as React from 'react';

import { Skeleton } from '@/components/ui/skeleton';

import type { CreditNoteFormInput, CreditNoteSubmitIntent } from '@/lib/forms/billing/schemas';

import type { CreditNote, Invoice, NavigationTarget, ReferenceRate } from './types';

export type CreditNoteFormProps = {
  initialCreditNote?: CreditNote | null;
  /**
   * Original invoice the credit applies against. v1 form requires this be
   * selected before any lines are added (GST reversal requires linkage per
   * Section 34 CGST Act).
   */
  initialOriginalInvoice?: Invoice | null;
  referenceRatesBySac: Record<string, ReferenceRate | null>;
  /** Section 34(2) cutoff for the original invoice's FY (Nov 30 next FY). */
  gstImpactWindowEnds: string;
  onSubmit: (input: CreditNoteFormInput, intent: CreditNoteSubmitIntent) => Promise<void>;
  /** Original invoice picker — search by document number or party. */
  onOriginalInvoiceSearch?: (query: string) => Promise<Invoice[]>;
  onSourceDocumentUpload?: (file: File) => Promise<{ documentId: string }>;
  onNavigate?: (target: NavigationTarget) => void;
  onCancel?: () => void;
  submitting?: boolean;
};

/**
 * C1.5 (c) — Credit note form. Mandatory original-invoice picker first; then
 * shows the original's lines and lets the user pick/adjust which to credit.
 * `gst_impact_allowed` banner reflects current status based on `document_date`
 * vs `gstImpactWindowEnds`. Pre-gate stub.
 */
export function CreditNoteForm({ submitting }: CreditNoteFormProps) {
  if (submitting) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="text-muted-foreground rounded-md border border-dashed p-8 text-sm">
      CreditNoteForm placeholder — full RHF + Zod form lands post-gate.
    </div>
  );
}
