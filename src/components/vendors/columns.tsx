'use client';

import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DateCell, MoneyCell } from '@/components/data-table/data-table-cells';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import type { Vendor, VendorCategory, VendorStatus } from './types';

const STATUS_TONES: Record<VendorStatus, StatusTone> = {
  active: 'success',
  inactive: 'neutral',
};

const CATEGORY_LABELS: Record<VendorCategory, string> = {
  photographer: 'Photographer',
  videographer: 'Videographer',
  printer: 'Printer',
  software: 'Software',
  agency: 'Agency',
  logistics: 'Logistics',
  other: 'Other',
};

export const vendorColumns: ColumnDef<Vendor>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
    meta: { exportLabel: 'Vendor' },
    cell: ({ row }) => (
      <div className="flex flex-col">
        <Link
          href={`/vendors/${row.original.id}`}
          className="text-foreground font-medium hover:underline"
        >
          {row.original.name}
        </Link>
        <span className="text-muted-foreground text-xs">{row.original.city}</span>
      </div>
    ),
  },
  {
    accessorKey: 'category',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
    meta: { exportLabel: 'Category' },
    cell: ({ row }) => CATEGORY_LABELS[row.original.category],
  },
  {
    accessorKey: 'gstin',
    header: ({ column }) => <DataTableColumnHeader column={column} title="GSTIN" />,
    meta: { exportLabel: 'GSTIN' },
    cell: ({ row }) =>
      row.original.gstin ? (
        <span className="font-mono text-xs">{row.original.gstin}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: 'tdsSection',
    header: ({ column }) => <DataTableColumnHeader column={column} title="TDS section" />,
    meta: { exportLabel: 'TDS section' },
    cell: ({ row }) =>
      row.original.tdsSection === 'none' ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="font-mono text-xs">{row.original.tdsSection}</span>
      ),
  },
  {
    accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    meta: { exportLabel: 'Status' },
    cell: ({ row }) => (
      <StatusBadge
        tone={STATUS_TONES[row.original.status]}
        label={row.original.status === 'active' ? 'Active' : 'Inactive'}
      />
    ),
  },
  {
    accessorKey: 'outstandingPaise',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Outstanding" />,
    meta: { exportLabel: 'Outstanding (₹)' },
    cell: ({ row }) => <MoneyCell paise={row.original.outstandingPaise} />,
    sortingFn: (a, b) => {
      const av = a.original.outstandingPaise;
      const bv = b.original.outstandingPaise;
      return av === bv ? 0 : av > bv ? 1 : -1;
    },
  },
  {
    accessorKey: 'lastTxnAt',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Last txn" />,
    meta: { exportLabel: 'Last transaction' },
    cell: ({ row }) => <DateCell value={row.original.lastTxnAt} />,
    sortingFn: (a, b) =>
      (a.original.lastTxnAt?.getTime() ?? 0) - (b.original.lastTxnAt?.getTime() ?? 0),
  },
];
