'use client';

import * as React from 'react';

import { Skeleton } from '@/components/ui/skeleton';

import type { Estimate, NavigationTarget } from './types';

export type EstimateConvertPayload = {
  /** % of total (1-100). Ignored if amount_paise set. */
  percentage?: number;
  /** Specific amount to invoice from this estimate. Ignored if line_ids set. */
  amount_paise?: bigint;
  /** Or pick specific line ids to invoice. */
  line_ids?: string[];
};

export type EstimateDetailProps = {
  estimate: Estimate | null;
  loading?: boolean;
  onNavigate?: (target: NavigationTarget) => void;
  onMarkAcceptedClick?: (estimateId: string) => void;
  onMarkRejectedClick?: (estimateId: string) => void;
  /**
   * "Convert to Invoice" affordance — dispatches with optional progress-billing
   * payload (% / amount / picked lines). v1 fires with `undefined` for full
   * conversion; v1.5 will surface the progress-invoice picker UI.
   */
  onConvert?: (estimateId: string, payload?: EstimateConvertPayload) => void;
  documentViewerSlot?: React.ReactNode;
};

/**
 * C1.4 (b) — Read-only estimate view.
 *
 * Same layout as InvoiceDetail with a "Convert to Invoice" CTA. Pre-gate stub.
 */
export function EstimateDetail({ estimate, loading }: EstimateDetailProps) {
  if (loading || !estimate) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="text-muted-foreground rounded-md border border-dashed p-8 text-sm">
      EstimateDetail placeholder — {estimate.document_number}
    </div>
  );
}
