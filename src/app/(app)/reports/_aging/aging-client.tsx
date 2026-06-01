'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatINR } from '@/components/shared/format-inr';
import { EntityRef } from '@/components/entity/entity-ref';
import { ReportShell } from '@/components/shared/report-shell';
import { useEntityNavigate } from '@/lib/client/use-navigate';
import type { AgingRow } from '@/lib/server-stub/ledger-types';

export type AgingClientProps = {
  side: 'receivable' | 'payable';
  rows: readonly AgingRow[];
  asOfDate: string;
  basePath: string;
};

export function AgingClient({ side, rows, asOfDate, basePath }: AgingClientProps) {
  const onNavigate = useEntityNavigate();
  const totals = rows.reduce(
    (acc, r) => ({
      '0-30': acc['0-30'] + r.byBucket['0-30'],
      '31-60': acc['31-60'] + r.byBucket['31-60'],
      '61-90': acc['61-90'] + r.byBucket['61-90'],
      '90+': acc['90+'] + r.byBucket['90+'],
      total: acc.total + r.totalPaise,
    }),
    { '0-30': 0n, '31-60': 0n, '61-90': 0n, '90+': 0n, total: 0n },
  );

  function exportCsv() {
    const header = [
      side === 'receivable' ? 'Client' : 'Vendor',
      '0-30',
      '31-60',
      '61-90',
      '90+',
      'Total',
    ].join(',');
    const lines = rows.map((r) =>
      [
        r.entityName,
        paiseToString(r.byBucket['0-30']),
        paiseToString(r.byBucket['31-60']),
        paiseToString(r.byBucket['61-90']),
        paiseToString(r.byBucket['90+']),
        paiseToString(r.totalPaise),
      ].join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${side === 'receivable' ? 'ar' : 'ap'}-aging-${asOfDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const entityType = side === 'receivable' ? 'client' : 'vendor';

  return (
    <ReportShell asOfDate={asOfDate} basePath={basePath} onExportCsv={exportCsv}>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>{side === 'receivable' ? 'Client' : 'Vendor'}</TableHead>
            <TableHead className="text-right">0-30 d</TableHead>
            <TableHead className="text-right">31-60 d</TableHead>
            <TableHead className="text-right">61-90 d</TableHead>
            <TableHead className="text-destructive text-right">90+ d</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.entityId}>
              <TableCell>
                <EntityRef
                  type={entityType}
                  id={r.entityId}
                  label={r.entityName}
                  onNavigate={onNavigate}
                />
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {r.byBucket['0-30'] > 0n ? formatINR(r.byBucket['0-30']) : '—'}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {r.byBucket['31-60'] > 0n ? formatINR(r.byBucket['31-60']) : '—'}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {r.byBucket['61-90'] > 0n ? formatINR(r.byBucket['61-90']) : '—'}
              </TableCell>
              <TableCell className="text-destructive text-right font-mono tabular-nums">
                {r.byBucket['90+'] > 0n ? formatINR(r.byBucket['90+']) : '—'}
              </TableCell>
              <TableCell className="text-right font-mono font-medium tabular-nums">
                {formatINR(r.totalPaise)}
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="bg-muted/20 font-medium">
            <TableCell>Totals</TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {formatINR(totals['0-30'])}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {formatINR(totals['31-60'])}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {formatINR(totals['61-90'])}
            </TableCell>
            <TableCell className="text-destructive text-right font-mono tabular-nums">
              {formatINR(totals['90+'])}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {formatINR(totals.total)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </ReportShell>
  );
}

function paiseToString(paise: bigint): string {
  const whole = paise / 100n;
  const rem = (paise % 100n).toString().padStart(2, '0');
  return `${whole.toString()}.${rem}`;
}
