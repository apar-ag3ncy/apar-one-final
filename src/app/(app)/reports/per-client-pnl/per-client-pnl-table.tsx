'use client';

import { useMemo, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { DateField as SharedDateField } from '@/components/shared/date-field';
import { formatINR } from '@/components/shared/format-inr';
import { ExportMenu } from '@/components/shared/export-menu';
import { EntityRef } from '@/components/entity/entity-ref';
import { useEntityNavigate } from '@/lib/client/use-navigate';
import { exportRows, paiseToRupees, type ExportFormat } from '@/lib/client/export-rows';
import type { PerClientPnLRow } from '@/lib/server-stub/ledger-types';
import { useRouter } from 'next/navigation';

export type PerClientPnLTableProps = {
  rows: readonly PerClientPnLRow[];
  fromDate: string;
  toDate: string;
};

export function PerClientPnLTable({ rows, fromDate, toDate }: PerClientPnLTableProps) {
  const router = useRouter();
  const onNavigate = useEntityNavigate();
  const [sorting, setSorting] = useState<SortingState>([{ id: 'revenuePaise', desc: true }]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        revenue: acc.revenue + r.revenuePaise,
        cost: acc.cost + r.directCostPaise,
        margin: acc.margin + r.grossMarginPaise,
        txns: acc.txns + r.txnCount,
      }),
      { revenue: 0n, cost: 0n, margin: 0n, txns: 0 },
    );
  }, [rows]);

  const columns = useMemo<ColumnDef<PerClientPnLRow>[]>(
    () => [
      {
        accessorKey: 'clientName',
        header: 'Client',
        cell: ({ row }) => (
          <EntityRef
            type="client"
            id={row.original.clientId}
            label={row.original.clientName}
            tab="transactions"
            onNavigate={onNavigate}
          />
        ),
      },
      {
        accessorKey: 'revenuePaise',
        header: () => <div className="text-right">Revenue</div>,
        cell: ({ row }) => (
          <div className="text-right font-mono tabular-nums">
            {formatINR(row.original.revenuePaise)}
          </div>
        ),
        sortingFn: bigintSortFn,
      },
      {
        accessorKey: 'directCostPaise',
        header: () => <div className="text-right">Direct cost</div>,
        cell: ({ row }) => (
          <div className="text-right font-mono tabular-nums">
            {formatINR(row.original.directCostPaise)}
          </div>
        ),
        sortingFn: bigintSortFn,
      },
      {
        accessorKey: 'grossMarginPaise',
        header: () => <div className="text-right">Gross margin</div>,
        cell: ({ row }) => {
          const positive = row.original.grossMarginPaise >= 0n;
          return (
            <div
              className={`text-right font-mono tabular-nums ${
                positive ? 'text-emerald-600' : 'text-destructive'
              }`}
            >
              {formatINR(row.original.grossMarginPaise)}
            </div>
          );
        },
        sortingFn: bigintSortFn,
      },
      {
        id: 'marginPct',
        header: () => <div className="text-right">Margin %</div>,
        cell: ({ row }) => {
          const r = row.original;
          if (r.revenuePaise === 0n) return <span className="text-muted-foreground">—</span>;
          const pct = Number((r.grossMarginPaise * 10000n) / r.revenuePaise) / 100;
          return <div className="text-right font-mono tabular-nums">{pct.toFixed(1)}%</div>;
        },
      },
      {
        accessorKey: 'txnCount',
        header: () => <div className="text-right">Txns</div>,
        cell: ({ row }) => <div className="text-right tabular-nums">{row.original.txnCount}</div>,
      },
    ],
    [onNavigate],
  );

  const table = useReactTable({
    data: rows as PerClientPnLRow[],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableMultiSort: true,
  });

  function handleExport(format: ExportFormat) {
    const headers = ['Client', 'Revenue', 'Direct Cost', 'Gross Margin', 'Margin %', 'Txns'];
    const marginPct = (margin: bigint, revenue: bigint): string =>
      revenue === 0n ? '' : (Number((margin * 10000n) / revenue) / 100).toFixed(1) + '%';
    const data: Record<string, string | number>[] = rows.map((r) => ({
      Client: r.clientName,
      Revenue: paiseToRupees(r.revenuePaise),
      'Direct Cost': paiseToRupees(r.directCostPaise),
      'Gross Margin': paiseToRupees(r.grossMarginPaise),
      'Margin %': marginPct(r.grossMarginPaise, r.revenuePaise),
      Txns: r.txnCount,
    }));
    data.push({
      Client: 'Totals',
      Revenue: paiseToRupees(totals.revenue),
      'Direct Cost': paiseToRupees(totals.cost),
      'Gross Margin': paiseToRupees(totals.margin),
      'Margin %': marginPct(totals.margin, totals.revenue),
      Txns: totals.txns,
    });
    exportRows(data, headers, `per-client-pnl-${fromDate}-${toDate}`, format, 'Per-Client P&L');
  }

  function applyDates(from: string, to: string) {
    const params = new URLSearchParams();
    params.set('from', from);
    params.set('to', to);
    router.push(`/reports/per-client-pnl?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end gap-3 pb-3">
          <DateField
            label="From"
            name="from"
            defaultValue={fromDate}
            onApply={(v) => applyDates(v, toDate)}
          />
          <DateField
            label="To"
            name="to"
            defaultValue={toDate}
            onApply={(v) => applyDates(fromDate, v)}
          />
          <div className="ml-auto flex items-center gap-2">
            <ExportMenu onExport={handleExport} disabled={rows.length === 0} />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="bg-muted/40 hover:bg-muted/40">
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      className="cursor-pointer select-none"
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {{ asc: ' ▲', desc: ' ▼' }[header.column.getIsSorted() as string] ?? null}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              <TableRow className="bg-muted/20 font-medium">
                <TableCell>Totals</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatINR(totals.revenue)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatINR(totals.cost)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatINR(totals.margin)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {totals.revenue === 0n
                    ? '—'
                    : `${(Number((totals.margin * 10000n) / totals.revenue) / 100).toFixed(1)}%`}
                </TableCell>
                <TableCell className="text-right tabular-nums">{totals.txns}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function DateField({
  label,
  name,
  defaultValue,
  onApply,
}: {
  label: string;
  name: string;
  defaultValue: string;
  onApply: (next: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={name} className="text-muted-foreground text-xs tracking-wide uppercase">
        {label}
      </Label>
      <SharedDateField
        id={name}
        value={defaultValue}
        onChange={onApply}
        clearable={false}
        className="w-44"
      />
    </div>
  );
}

function bigintSortFn<TRow>(rowA: { original: TRow }, rowB: { original: TRow }, columnId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = (rowA.original as any)[columnId] as bigint;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = (rowB.original as any)[columnId] as bigint;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
