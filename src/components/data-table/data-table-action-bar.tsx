'use client';

import * as React from 'react';
import type { Row, Table } from '@tanstack/react-table';
import { XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Floating action bar surfaced when ≥1 row is selected.
 *
 * SPEC-AMENDMENT-001 §2.2: every TanStack Table that supports bulk
 * select gets one of these. Anchored to the bottom of the viewport,
 * shows row count + selected actions (capability-gated by the caller).
 *
 * The bar is intentionally caller-driven: the consumer passes `actions`
 * built from the entity-type-appropriate verbs:
 *   - clients/vendors/employees: Archive (admin), Delete permanently (partner)
 *   - POCs / addresses / banks / docs: Delete selected
 *   - Draft transactions: Delete selected drafts
 *   - Posted transactions: Reverse selected (NEVER Delete)
 *   - Postings: bar is not used at all
 */
export type ActionBarAction<TData> = {
  id: string;
  label: string;
  /** Tone drives the button variant; 'destructive' makes the button red. */
  tone?: 'default' | 'destructive';
  /** Render an optional leading icon. */
  icon?: React.ReactNode;
  /** When false, hide the action (capability gate). */
  visible?: boolean;
  /** When true, render a disabled / loading button. */
  pending?: boolean;
  /** Called with the selected rows; consumer fires the server action. */
  onSelect: (rows: readonly Row<TData>[]) => void | Promise<void>;
};

export type DataTableActionBarProps<TData> = {
  table: Table<TData>;
  actions: readonly ActionBarAction<TData>[];
  /**
   * Optional override for the row-count label. e.g. when the entity is
   * 'vendors' display "3 vendors selected" instead of "3 rows selected".
   */
  entityLabel?: { singular: string; plural: string };
  className?: string;
};

export function DataTableActionBar<TData>({
  table,
  actions,
  entityLabel,
  className,
}: DataTableActionBarProps<TData>) {
  const selected = table.getSelectedRowModel().rows;
  const count = selected.length;
  if (count === 0) return null;

  const noun = entityLabel
    ? count === 1
      ? entityLabel.singular
      : entityLabel.plural
    : count === 1
      ? 'row'
      : 'rows';

  const visibleActions = actions.filter((a) => a.visible !== false);

  return (
    <div
      className={cn(
        'bg-background fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border px-4 py-2 shadow-lg',
        className,
      )}
      role="region"
      aria-label="Bulk actions"
    >
      <span className="text-sm font-medium">
        {count} {noun} selected
      </span>
      <div className="bg-border h-5 w-px" aria-hidden />
      <div className="flex items-center gap-2">
        {visibleActions.map((action) => (
          <Button
            key={action.id}
            size="sm"
            variant={action.tone === 'destructive' ? 'destructive' : 'outline'}
            disabled={action.pending}
            onClick={() => action.onSelect(selected)}
          >
            {action.icon}
            {action.label}
          </Button>
        ))}
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Clear selection"
        onClick={() => table.resetRowSelection()}
        className="size-8 rounded-full"
      >
        <XIcon className="size-4" aria-hidden />
      </Button>
    </div>
  );
}
