'use client';

import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DateCell } from '@/components/data-table/data-table-cells';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { departmentLabel } from './types';
import type { Employee, EmployeeStatus, EmploymentType } from './types';

const STATUS_TONES: Record<EmployeeStatus, StatusTone> = {
  active: 'success',
  notice: 'warning',
  separated: 'neutral',
};

const STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: 'Active',
  notice: 'On notice',
  separated: 'Separated',
};

const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contractor: 'Contractor',
  intern: 'Intern',
};

export const employeeColumns: ColumnDef<Employee>[] = [
  {
    accessorKey: 'fullName',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Employee" />,
    meta: { exportLabel: 'Employee' },
    cell: ({ row }) => (
      <div className="flex flex-col max-w-[320px] break-words whitespace-normal">
        <Link
          href={`/employees/${row.original.id}`}
          className="text-foreground font-medium hover:underline"
        >
          {row.original.fullName}
        </Link>
        <span className="text-muted-foreground text-xs">{row.original.workEmail}</span>
      </div>
    ),
  },
  {
    accessorKey: 'designation',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Designation" />,
    meta: { exportLabel: 'Designation' },
  },
  {
    accessorKey: 'department',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Department" />,
    meta: { exportLabel: 'Department' },
    cell: ({ row }) => departmentLabel(row.original.department),
  },
  {
    accessorKey: 'employmentType',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
    meta: { exportLabel: 'Employment type' },
    cell: ({ row }) => EMPLOYMENT_LABELS[row.original.employmentType],
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
    accessorKey: 'joinedAt',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Joined" />,
    meta: { exportLabel: 'Joined' },
    cell: ({ row }) => <DateCell value={row.original.joinedAt} />,
    sortingFn: (a, b) => a.original.joinedAt.getTime() - b.original.joinedAt.getTime(),
  },
  {
    accessorKey: 'reportsTo',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Reports to" />,
    meta: { exportLabel: 'Reports to' },
    cell: ({ row }) => row.original.reportsTo ?? <span className="text-muted-foreground">—</span>,
  },
];
