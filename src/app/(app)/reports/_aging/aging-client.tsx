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
import { exportRows, paiseToRupees, type ExportFormat } from '@/lib/client/export-rows';
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

  function handleExport(format: ExportFormat) {
    const entityLabel = side === 'receivable' ? 'Client' : 'Vendor';
    const headers = [entityLabel, '0-30', '31-60', '61-90', '90+', 'Total'];
    const data: Record<string, string | number>[] = rows.map((r) => ({
      [entityLabel]: r.entityName,
      '0-30': paiseToRupees(r.byBucket['0-30']),
      '31-60': paiseToRupees(r.byBucket['31-60']),
      '61-90': paiseToRupees(r.byBucket['61-90']),
      '90+': paiseToRupees(r.byBucket['90+']),
      Total: paiseToRupees(r.totalPaise),
    }));
    data.push({
      [entityLabel]: 'Totals',
      '0-30': paiseToRupees(totals['0-30']),
      '31-60': paiseToRupees(totals['31-60']),
      '61-90': paiseToRupees(totals['61-90']),
      '90+': paiseToRupees(totals['90+']),
      Total: paiseToRupees(totals.total),
    });
    const name = `${side === 'receivable' ? 'ar' : 'ap'}-aging-${asOfDate}`;
    exportRows(data, headers, name, format, side === 'receivable' ? 'AR Aging' : 'AP Aging');
  }

  const entityType = side === 'receivable' ? 'client' : 'vendor';

  return (
    <ReportShell asOfDate={asOfDate} basePath={basePath} onExport={handleExport}>
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
