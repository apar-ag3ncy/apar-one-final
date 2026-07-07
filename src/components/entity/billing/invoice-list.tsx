'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { CopyIcon, FileXIcon, ReceiptTextIcon, SendIcon } from 'lucide-react';

import { DataTable } from '@/components/data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DateCell, MoneyCell } from '@/components/data-table/data-table-cells';
import type { ActionBarAction } from '@/components/data-table/data-table-action-bar';
import { EntityRef } from '@/components/entity/entity-ref';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';

import type {
  BaseListProps,
  Invoice,
  InvoiceBulkAction,
  InvoiceState,
  InvoiceFilters,
} from './types';

export type InvoiceListProps = BaseListProps<InvoiceFilters, InvoiceBulkAction> & {
  invoices: Invoice[];
  /** Default columns shown when the user has no saved preference. Unused in v1 — column picker uses `tableKey` to persist. */
  defaultVisibleColumns?: string[];
  /** Capability gates supplied by the host; an action with `visible=false` is hidden from the action bar. */
  capabilities?: {
    canSend?: boolean;
    canVoid?: boolean;
    canDuplicate?: boolean;
  };
};

const STATE_TONE: Record<InvoiceState, StatusTone> = {
  draft: 'neutral',
  sent: 'info',
  partially_paid: 'warning',
  paid: 'success',
  void: 'danger',
};

const STATE_LABEL: Record<InvoiceState, string> = {
  draft: 'Draft',
  sent: 'Sent',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  void: 'Deleted',
};

/**
 * C1.1 — TanStack DataTable wrapper for invoices. Columns are intentionally
 * inline (small enough); when adding the column picker presets, lift them to
 * `./columns/invoice-columns.ts`.
 *
 * Dumb-component rules (per agent prompt):
 *   - Data via props (`invoices`).
 *   - Navigation via `onNavigate(target)` — EntityRef cells fire it.
 *   - Bulk actions via `onBulkAction(action, ids)` — the action-bar verbs are
 *     constructed here from the callback.
 *   - No direct server-action imports. The host (Dashboard route or OS
 *     window) wires real CRUD.
 */
export function InvoiceList({
  invoices,
  loading,
  onNavigate,
  onBulkAction,
  capabilities,
  tableKey,
  totalRows,
}: InvoiceListProps) {
  const columns = React.useMemo<ColumnDef<Invoice>[]>(
    () => buildInvoiceColumns({ onNavigate }),
    [onNavigate],
  );

  const bulkActions: ActionBarAction<Invoice>[] = React.useMemo(() => {
    if (!onBulkAction) return [];
    return [
      {
        id: 'send',
        label: 'Send',
        visible: capabilities?.canSend ?? true,
        icon: <SendIcon className="size-4" aria-hidden />,
        onSelect: (rows) =>
          onBulkAction(
            'send',
            rows.map((r) => r.original.id),
          ),
      },
      {
        id: 'duplicate',
        label: 'Duplicate',
        visible: capabilities?.canDuplicate ?? true,
        icon: <CopyIcon className="size-4" aria-hidden />,
        onSelect: (rows) =>
          onBulkAction(
            'duplicate',
            rows.map((r) => r.original.id),
          ),
      },
      {
        id: 'export_csv',
        label: 'Export CSV',
        visible: true,
        icon: <ReceiptTextIcon className="size-4" aria-hidden />,
        onSelect: (rows) =>
          onBulkAction(
            'export_csv',
            rows.map((r) => r.original.id),
          ),
      },
      {
        id: 'void',
        label: 'Delete',
        tone: 'destructive',
        visible: capabilities?.canVoid ?? false,
        icon: <FileXIcon className="size-4" aria-hidden />,
        onSelect: (rows) =>
          onBulkAction(
            'void',
            rows.map((r) => r.original.id),
          ),
      },
    ];
  }, [onBulkAction, capabilities]);

  return (
    <DataTable<Invoice, unknown>
      columns={columns}
      data={invoices}
      loading={loading}
      tableKey={tableKey ?? 'billing.invoices.list'}
      exportFilename="invoices"
      bulkActions={bulkActions.length > 0 ? bulkActions : undefined}
      bulkEntityLabel={{ singular: 'invoice', plural: 'invoices' }}
      searchPlaceholder="Search invoice number or party…"
      onRowClick={
        onNavigate
          ? (row) =>
              onNavigate({
                type: 'transaction',
                id: row.original.id,
                tab: 'invoice',
              })
          : undefined
      }
      emptyState={{
        icon: ReceiptTextIcon,
        title: 'No invoices yet',
        description: 'Create your first invoice to start billing clients.',
      }}
      serverPagination={
        typeof totalRows === 'number'
          ? { totalRows, pageCount: Math.max(1, Math.ceil(totalRows / 25)) }
          : undefined
      }
    />
  );
}

function buildInvoiceColumns(opts: {
  onNavigate?: InvoiceListProps['onNavigate'];
}): ColumnDef<Invoice>[] {
  return [
    {
      accessorKey: 'document_number',
      meta: { exportLabel: 'Invoice #' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice #" />,
      cell: ({ row }) => (
        <button
          type="button"
          className="text-foreground hover:text-primary hover:underline focus-visible:outline-none"
          onClick={(e) => {
            e.stopPropagation();
            opts.onNavigate?.({
              type: 'transaction',
              id: row.original.id,
              tab: 'invoice',
            });
          }}
        >
          <span className="font-medium">{row.original.document_number}</span>
        </button>
      ),
    },
    {
      id: 'party',
      meta: { exportLabel: 'Client' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Client" />,
      accessorFn: (row) => row.party.label,
      cell: ({ row }) => (
        <EntityRef
          type={row.original.party.type}
          id={row.original.party.id}
          label={row.original.party.label}
          tab={row.original.party.tab}
          onNavigate={opts.onNavigate}
        />
      ),
    },
    {
      accessorKey: 'document_date',
      meta: { exportLabel: 'Date' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
      cell: ({ row }) => <DateCell value={row.original.document_date} />,
    },
    {
      accessorKey: 'due_date',
      meta: { exportLabel: 'Due' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Due" />,
      cell: ({ row }) => <DateCell value={row.original.due_date} />,
    },
    {
      accessorKey: 'captured_total_paise',
      meta: { exportLabel: 'Total', align: 'right' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Total" className="justify-end" />
      ),
      cell: ({ row }) => (
        <MoneyCell paise={row.original.captured_total_paise} className="text-right" />
      ),
    },
    {
      accessorKey: 'paid_paise',
      meta: { exportLabel: 'Paid', align: 'right' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Paid" className="justify-end" />
      ),
      cell: ({ row }) => <MoneyCell paise={row.original.paid_paise} className="text-right" />,
    },
    {
      accessorKey: 'balance_paise',
      meta: { exportLabel: 'Balance', align: 'right' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Balance" className="justify-end" />
      ),
      cell: ({ row }) => {
        const balance = row.original.balance_paise;
        const hasBalance = balance > 0n;
        return (
          <MoneyCell paise={balance} className={cn('text-right', hasBalance && 'font-medium')} />
        );
      },
    },
    {
      accessorKey: 'state',
      meta: { exportLabel: 'State' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="State" />,
      cell: ({ row }) => (
        <StatusBadge
          tone={STATE_TONE[row.original.state]}
          label={STATE_LABEL[row.original.state]}
        />
      ),
      filterFn: (row, _id, filterValue: string[]) =>
        filterValue.length === 0 || filterValue.includes(row.original.state),
    },
  ];
}
