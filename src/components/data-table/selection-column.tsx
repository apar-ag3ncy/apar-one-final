'use client';

import type { ColumnDef, Row } from '@tanstack/react-table';
import { Checkbox } from '@/components/ui/checkbox';

/**
 * Drop-in checkbox column for TanStack tables that want bulk select.
 *
 * Per SPEC-AMENDMENT-001 §2.2: every list table gets this as the first
 * column. The header checkbox toggles all visible (filtered + paged-in)
 * rows. Pair with `<DataTableActionBar>` for the floating action bar.
 *
 * The `id` is the literal string 'select' — the view-options and
 * preference-persistence layers special-case this id (excluded from
 * the column picker and from the saved visible-column list).
 */
export function selectionColumn<TData>(): ColumnDef<TData> {
  return {
    id: 'select',
    enableHiding: false,
    enableSorting: false,
    size: 32,
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected()
            ? true
            : table.getIsSomePageRowsSelected()
              ? 'indeterminate'
              : false
        }
        onCheckedChange={(v) => table.toggleAllPageRowsSelected(v === true)}
        aria-label="Select all rows on this page"
      />
    ),
    cell: ({ row }: { row: Row<TData> }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(v) => row.toggleSelected(v === true)}
        onClick={(e) => e.stopPropagation()}
        aria-label="Select row"
      />
    ),
  };
}
