'use client';

import * as React from 'react';

import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

import type { ServiceItemFormInput } from '@/lib/forms/billing/schemas';

import type { ServiceItem } from './types';

export type ServiceItemsTableProps = {
  items: ServiceItem[];
  loading?: boolean;
  /** Create / edit / archive — host wires real mutations behind these. */
  onCreate?: (input: ServiceItemFormInput) => Promise<void>;
  onUpdate?: (id: string, input: ServiceItemFormInput) => Promise<void>;
  onArchive?: (id: string) => Promise<void>;
  /** Reactivate an archived item. */
  onRestore?: (id: string) => Promise<void>;
};

/**
 * C1.10 — Service items catalog CRUD.
 *
 * Columns: name | sac_code | default_rate | default_tax_rate | active | actions.
 * Inline editor opens via dialog; the form uses ServiceItemFormSchema.
 *
 * Pre-gate stub.
 */
export function ServiceItemsTable({ items, loading }: ServiceItemsTableProps) {
  if (loading) return <Skeleton className="h-72 w-full" />;
  if (items.length === 0) {
    return (
      <EmptyState
        title="No service items yet"
        description="Add a service (e.g. Brand Strategy, SAC 998311) so invoices snap to your catalog."
      />
    );
  }
  return (
    <div className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
      ServiceItemsTable placeholder — {items.length} item{items.length === 1 ? '' : 's'} loaded.
    </div>
  );
}
