'use client';

import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DateCell } from '@/components/data-table/data-table-cells';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import type { Client, ClientPriority, ClientStatus } from './types';

const STATUS_TONES: Record<ClientStatus, StatusTone> = {
  active: 'success',
  onboarding: 'info',
  inactive: 'neutral',
  archived: 'neutral',
};

const STATUS_LABELS: Record<ClientStatus, string> = {
  active: 'Active',
  onboarding: 'Onboarding',
  inactive: 'Inactive',
  archived: 'Archived',
};

const PRIORITY_TONES: Record<ClientPriority, StatusTone> = {
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  strategic: 'accent',
};

export const clientColumns: ColumnDef<Client>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Client" />,
    meta: { exportLabel: 'Client' },
    cell: ({ row }) => (
      <div className="flex flex-col">
        <Link
          href={`/clients/${row.original.id}`}
          className="text-foreground font-medium hover:underline"
        >
          {row.original.name}
        </Link>
        <span className="text-muted-foreground text-xs">{row.original.city}</span>
      </div>
    ),
  },
  {
    accessorKey: 'industry',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Industry" />,
    meta: { exportLabel: 'Industry' },
  },
  {
    accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    meta: { exportLabel: 'Status' },
    cell: ({ row }) => {
      const status = row.original.status;
      return <StatusBadge tone={STATUS_TONES[status]} label={STATUS_LABELS[status]} />;
    },
    filterFn: (row, _id, filterValue: string[]) =>
      filterValue.length === 0 || filterValue.includes(row.original.status),
  },
  {
    accessorKey: 'priority',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Priority" />,
    meta: { exportLabel: 'Priority' },
    cell: ({ row }) => (
      <StatusBadge
        tone={PRIORITY_TONES[row.original.priority]}
        label={row.original.priority[0]!.toUpperCase() + row.original.priority.slice(1)}
        dot={false}
      />
    ),
  },
  {
    accessorKey: 'accountManager',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Account manager" />,
    meta: { exportLabel: 'Account manager' },
  },
  {
    accessorKey: 'projectsCount',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Projects" />,
    meta: { exportLabel: 'Projects' },
    cell: ({ row }) => <span className="tabular-nums">{row.original.projectsCount}</span>,
  },
  {
    accessorKey: 'lastActivityAt',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Last activity" />,
    meta: { exportLabel: 'Last activity' },
    cell: ({ row }) => <DateCell value={row.original.lastActivityAt} />,
    sortingFn: (a, b) => {
      const av = a.original.lastActivityAt?.getTime() ?? 0;
      const bv = b.original.lastActivityAt?.getTime() ?? 0;
      return av - bv;
    },
  },
  {
    accessorKey: 'onboardedAt',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Onboarded" />,
    meta: { exportLabel: 'Onboarded' },
    cell: ({ row }) => <DateCell value={row.original.onboardedAt} />,
    sortingFn: (a, b) => a.original.onboardedAt.getTime() - b.original.onboardedAt.getTime(),
  },
];
