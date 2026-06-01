'use client';

import * as React from 'react';

import { Skeleton } from '@/components/ui/skeleton';

import type { BillFormInput, BillSubmitIntent } from '@/lib/forms/billing/schemas';

import type { Bill, NavigationTarget, ReferenceRate } from './types';

export type ExpenseAccountOption = {
  code: string; // e.g. '6200'
  name: string; // e.g. 'Office Rent & Utilities'
};

export type ClientOption = {
  id: string;
  label: string;
};

export type ProjectOption = {
  id: string;
  label: string;
  client_id: string;
};

export type BillFormProps = {
  initialBill?: Bill | null;
  /** Reference TDS rates keyed by section. ReferenceRatePill consumes these. */
  referenceTdsRatesBySection: Record<string, ReferenceRate | null>;
  /** Reference GST rates keyed by SAC for line tax pills. */
  referenceGstRatesBySac: Record<string, ReferenceRate | null>;
  /** Expense accounts (6xxx) for attribution='opex'. */
  expenseAccountOptions: ExpenseAccountOption[];
  /**
   * Fixed account code used when attribution='asset'. Defaults to '1510' per
   * LEDGER-SPEC §3.4; settable so future capitalization-threshold flows can
   * override.
   */
  defaultAssetAccountCode?: string;
  supplierStateCode: string;
  onSubmit: (input: BillFormInput, intent: BillSubmitIntent) => Promise<void>;
  /** Vendor picker — search by name / GSTIN / phone. */
  onVendorSearch?: (query: string) => Promise<NavigationTarget[]>;
  /** Inline-create vendor (Alt+C equivalent). */
  onVendorCreateInline?: (name: string) => Promise<{ id: string; label: string }>;
  onClientSearch?: (query: string) => Promise<ClientOption[]>;
  onProjectSearch?: (query: string, clientId?: string) => Promise<ProjectOption[]>;
  onSourceDocumentUpload?: (file: File) => Promise<{ documentId: string }>;
  onNavigate?: (target: NavigationTarget) => void;
  onCancel?: () => void;
  submitting?: boolean;
};

/**
 * C1.6 (c) — Vendor bill form. **The critical enforcement point.**
 *
 * Hard contract (LEDGER-SPEC §3.4 + agent prompt's STOP-AND-ASK rules):
 *   1. Vendor picker is the first required field.
 *   2. Attribution radio group (client / opex / asset) is the SECOND required
 *      question — the form refuses to advance until answered.
 *   3. Conditional reveal:
 *        client → client picker + project picker
 *        opex   → expense account picker (6xxx)
 *        asset  → defaultAssetAccountCode (1510), no extra field
 *   4. Line items, GST capture (with ReferenceRatePill per line),
 *      TDS capture with section reference rate pill.
 *   5. Source document upload via existing uploadDocument flow.
 *
 * The form's Zod schema (`BillFormSchema`) carries a superRefine that mirrors
 * (3); submit cannot succeed without the required field for the chosen
 * attribution. Pre-gate stub.
 */
export function BillForm({ submitting }: BillFormProps) {
  if (submitting) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="text-muted-foreground rounded-md border border-dashed p-8 text-sm">
      BillForm placeholder — full RHF + Zod form lands post-gate. Hard rule: vendor → attribution →
      conditional fields → lines → TDS → attachment.
    </div>
  );
}
