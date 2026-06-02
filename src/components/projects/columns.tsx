'use client';

import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DateCell, MoneyCell } from '@/components/data-table/data-table-cells';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import type { BillingModel, Project, ProjectStatus } from './types';

const STATUS_TONES: Record<ProjectStatus, StatusTone> = {
  pitching: 'info',
  active: 'success',
  on_hold: 'warning',
  delivered: 'accent',
  closed: 'neutral',
};

const STATUS_LABELS: Record<ProjectStatus, string> = {
  pitching: 'Pitching',
  active: 'Active',
  on_hold: 'On hold',
  delivered: 'Delivered',
  closed: 'Closed',
};

const BILLING_LABELS: Record<BillingModel, string> = {
  retainer: 'Retainer',
  fixed_fee: 'Fixed fee',
  time_and_materials: 'T&M',
  milestone: 'Milestone',
};

export const projectColumns: ColumnDef<Project>[] = [
  {
    accessorKey: 'code',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />,
    meta: { exportLabel: 'Code' },
    cell: ({ row }) => (
      <Link href={`/projects/${row.original.id}`} className="font-mono text-xs hover:underline">
        {row.original.code}
      </Link>
    ),
  },
  {
    accessorKey: 'name',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
    meta: { exportLabel: 'Project' },
    cell: ({ row }) => (
      <Link
        href={`/projects/${row.original.id}`}
        className="text-foreground font-medium hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: 'clientName',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Client" />,
    meta: { exportLabel: 'Client' },
    cell: ({ row }) => (
      <Link href={`/clients/${row.original.clientId}`} className="hover:underline">
        {row.original.clientName}
        {row.original.clientArchived ? (
          <span className="text-muted-foreground ml-1">(ex-client)</span>
        ) : null}
      </Link>
    ),
  },
  {
    accessorKey: 'leadName',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Lead" />,
    meta: { exportLabel: 'Lead' },
  },
  {
    accessorKey: 'billingModel',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Billing" />,
    meta: { exportLabel: 'Billing model' },
    cell: ({ row }) => BILLING_LABELS[row.original.billingModel],
  },
  {
    accessorKey: 'feePaise',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Fee" />,
    meta: { exportLabel: 'Fee (₹)' },
    cell: ({ row }) => <MoneyCell paise={row.original.feePaise} />,
    sortingFn: (a, b) => (a.original.feePaise > b.original.feePaise ? 1 : -1),
  },
  {
    accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    meta: { exportLabel: 'Status' },
    cell: ({ row }) => (
      <StatusBadge
        tone={STATUS_TONES[row.original.status]}
        label={STATUS_LABELS[row.original.status]}
      />
    ),
  },
  {
    accessorKey: 'startedAt',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Started" />,
    meta: { exportLabel: 'Started' },
    cell: ({ row }) => <DateCell value={row.original.startedAt} />,
    sortingFn: (a, b) => a.original.startedAt.getTime() - b.original.startedAt.getTime(),
  },
];
