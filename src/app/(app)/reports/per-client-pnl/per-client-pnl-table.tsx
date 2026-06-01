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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatINR } from '@/components/shared/format-inr';
import { EntityRef } from '@/components/entity/entity-ref';
import { useEntityNavigate } from '@/lib/client/use-navigate';
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

  function exportCsv() {
    const header = ['Client', 'Revenue', 'Direct Cost', 'Gross Margin', 'Margin %', 'Txns'].join(
      ',',
    );
    const lines = rows.map((r) => {
      const pct =
        r.revenuePaise === 0n
          ? ''
          : (Number((r.grossMarginPaise * 10000n) / r.revenuePaise) / 100).toFixed(1) + '%';
      return [
        escapeCsv(r.clientName),
        paiseToRupeeString(r.revenuePaise),
        paiseToRupeeString(r.directCostPaise),
        paiseToRupeeString(r.grossMarginPaise),
        pct,
        r.txnCount,
      ].join(',');
    });
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `per-client-pnl-${fromDate}-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
            <Button variant="outline" size="sm" onClick={exportCsv}>
              Export CSV
            </Button>
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
      <Input
        id={name}
        type="date"
        defaultValue={defaultValue}
        onChange={(e) => onApply(e.target.value)}
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

function escapeCsv(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function paiseToRupeeString(paise: bigint): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const whole = abs / 100n;
  const rem = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${rem}`;
}
