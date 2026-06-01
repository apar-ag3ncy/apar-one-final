'use client';

import * as React from 'react';

import { Skeleton } from '@/components/ui/skeleton';

import type { ReceiptFormInput, ReceiptSubmitIntent } from '@/lib/forms/billing/schemas';

import type { Invoice, NavigationTarget, ReceiptMethod, ReferenceRate } from './types';

export type BankAccountOption = {
  id: string;
  label: string;
  account_last4: string;
};

export type OpenInvoiceForAllocation = Pick<
  Invoice,
  'id' | 'document_number' | 'document_date' | 'due_date' | 'balance_paise'
>;

export type ReceiptFormProps = {
  /** Edit mode seed. */
  initialReceipt?: Partial<ReceiptFormInput> | null;
  /** Open invoices for the chosen client, used to auto-FIFO and let the user override. */
  openInvoicesForParty: OpenInvoiceForAllocation[];
  bankAccountOptions: BankAccountOption[];
  /** Reference TDS rates keyed by section for the captured-TDS pill. */
  referenceTdsRatesBySection: Record<string, ReferenceRate | null>;
  /**
   * Methods the user can pick. When 'razorpay' is selected and a
   * payment_link_id is set, the form locks the method and the payment-link
   * field (origin is the webhook).
   */
  availableMethods?: ReceiptMethod[];
  onSubmit: (input: ReceiptFormInput, intent: ReceiptSubmitIntent) => Promise<void>;
  onPartySearch?: (query: string) => Promise<NavigationTarget[]>;
  onSourceDocumentUpload?: (file: File) => Promise<{ documentId: string }>;
  onNavigate?: (target: NavigationTarget) => void;
  onCancel?: () => void;
  submitting?: boolean;
};

/**
 * C1.7 (c) — Receipt form.
 *
 * Sections:
 *   - Party picker (client)
 *   - Receipt date + bank account picker
 *   - Method picker — for method='razorpay', payment_link_id is read-only
 *     (sourced from webhook) and method is locked
 *   - Amount + TDS deduction capture (with ReferenceRatePill on section)
 *   - Allocation editor: list of party's open invoices with allocation amounts.
 *     Default is auto-FIFO; user may override per row.
 *
 * Pre-gate stub.
 */
export function ReceiptForm({ submitting }: ReceiptFormProps) {
  if (submitting) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="text-muted-foreground rounded-md border border-dashed p-8 text-sm">
      ReceiptForm placeholder — full RHF + Zod form lands post-gate.
    </div>
  );
}
