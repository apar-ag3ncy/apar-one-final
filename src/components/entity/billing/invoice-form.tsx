'use client';

import * as React from 'react';

import { Skeleton } from '@/components/ui/skeleton';

import type { InvoiceFormInput, InvoiceSubmitIntent } from '@/lib/forms/billing/schemas';

import type { Invoice, NavigationTarget, ReferenceRate, ServiceItem } from './types';

export type InvoiceFormProps = {
  /** When editing, the existing invoice to seed the form. */
  initialInvoice?: Invoice | null;
  /** Catalog items for the service-item picker on each line. */
  serviceItems: ServiceItem[];
  /**
   * Reference GST rate keyed by SAC code; ReferenceRatePill consumes from here.
   * Tax fields stay user-entered — captured-not-computed.
   */
  referenceRatesBySac: Record<string, ReferenceRate | null>;
  /** Apar's own state (Maharashtra) for the auto-derived place-of-supply hint. */
  supplierStateCode: string;
  /**
   * Single submit callback; both "Save Draft" and "Save and Send" call this
   * with different intents.
   */
  onSubmit: (input: InvoiceFormInput, intent: InvoiceSubmitIntent) => Promise<void>;
  /** Pickers and document upload are wired by the host via these callbacks. */
  onPartyPick?: (query: string) => Promise<NavigationTarget[]>;
  onPartyCreateInline?: (name: string) => Promise<{ id: string; label: string }>;
  onServiceItemCreateInline?: (
    payload: Pick<ServiceItem, 'name' | 'sac_code' | 'default_rate_paise' | 'default_tax_rate_bps'>,
  ) => Promise<ServiceItem>;
  onSourceDocumentUpload?: (file: File) => Promise<{ documentId: string }>;
  onNavigate?: (target: NavigationTarget) => void;
  /** Cancel returns to whatever the host chooses (list, parent window, etc.). */
  onCancel?: () => void;
  submitting?: boolean;
};

/**
 * C1.3 — Invoice create/edit form (RHF + Zod via InvoiceFormSchema).
 *
 * Sections:
 *   - Party picker (EntityRef-aware) with create-new-inline modal
 *   - Document date / due date pickers
 *   - Line items grid (add/remove rows, SAC catalog picker, inline create)
 *     - qty × rate auto-fills captured_taxable_value
 *     - captured_tax_amount is USER-ENTERED with ReferenceRatePill next to it
 *   - place_of_supply auto-derived (supplier vs party state) but editable
 *     - Pill: "intra-state CGST+SGST" or "inter-state IGST"
 *   - GST split inputs (CGST/SGST/IGST/cess in rupee strings → paise on submit)
 *   - Source document upload via existing uploadDocument flow
 *   - Save Draft / Save and Send buttons; intent passed via onSubmit
 *
 * Pre-gate stub.
 */
export function InvoiceForm({ submitting }: InvoiceFormProps) {
  if (submitting) {
    return <Skeleton className="h-96 w-full" />;
  }
  // TODO(post-gate): full RHF + Zod form. Use ReferenceRatePill on every tax
  //   input. Auto-derive place_of_supply_kind from supplierStateCode vs the
  //   selected party's billing state. Wire onPartyCreateInline +
  //   onServiceItemCreateInline for Tally-style Alt+C inline creation.
  return (
    <div className="text-muted-foreground rounded-md border border-dashed p-8 text-sm">
      InvoiceForm placeholder — full RHF + Zod form lands post-gate.
    </div>
  );
}
