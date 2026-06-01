'use client';

import * as React from 'react';

import { Skeleton } from '@/components/ui/skeleton';

import type { EstimateFormInput, EstimateSubmitIntent } from '@/lib/forms/billing/schemas';

import type { Estimate, NavigationTarget, ReferenceRate, ServiceItem } from './types';

export type EstimateFormProps = {
  initialEstimate?: Estimate | null;
  serviceItems: ServiceItem[];
  referenceRatesBySac: Record<string, ReferenceRate | null>;
  supplierStateCode: string;
  onSubmit: (input: EstimateFormInput, intent: EstimateSubmitIntent) => Promise<void>;
  onPartyPick?: (query: string) => Promise<NavigationTarget[]>;
  onPartyCreateInline?: (name: string) => Promise<{ id: string; label: string }>;
  onServiceItemCreateInline?: (
    payload: Pick<ServiceItem, 'name' | 'sac_code' | 'default_rate_paise' | 'default_tax_rate_bps'>,
  ) => Promise<ServiceItem>;
  onSourceDocumentUpload?: (file: File) => Promise<{ documentId: string }>;
  onNavigate?: (target: NavigationTarget) => void;
  onCancel?: () => void;
  submitting?: boolean;
};

/**
 * C1.4 (c) — Estimate form. Same layout as InvoiceForm minus the AR-specific
 * pieces; adds an expiry date. Pre-gate stub.
 */
export function EstimateForm({ submitting }: EstimateFormProps) {
  if (submitting) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="text-muted-foreground rounded-md border border-dashed p-8 text-sm">
      EstimateForm placeholder — full RHF + Zod form lands post-gate.
    </div>
  );
}
