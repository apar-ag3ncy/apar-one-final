'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/shared/status-badge';
import { formatINR } from '@/components/shared/format-inr';
import { ReportShell } from '@/components/shared/report-shell';
import type { TrialBalanceRow } from '@/lib/server-stub/ledger-types';

export function TrialBalanceClient({
  rows,
  asOfDate,
  includeReversed,
}: {
  rows: readonly TrialBalanceRow[];
  asOfDate: string;
  includeReversed: boolean;
}) {
  const totalDebit = rows.reduce((s, r) => s + r.debitPaise, 0n);
  const totalCredit = rows.reduce((s, r) => s + r.creditPaise, 0n);
  const balanced = totalDebit === totalCredit;

  function exportCsv() {
    const header = ['Code', 'Account', 'Debit', 'Credit'].join(',');
    const lines = rows.map((r) =>
      [
        r.accountCode,
        r.accountName,
        paiseToString(r.debitPaise),
        paiseToString(r.creditPaise),
      ].join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trial-balance-${asOfDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <ReportShell
      asOfDate={asOfDate}
      includeReversed={includeReversed}
      showIncludeReversed
      basePath="/reports/trial-balance"
      onExportCsv={exportCsv}
    >
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>Account</TableHead>
            <TableHead className="text-right">Debit</TableHead>
            <TableHead className="text-right">Credit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.accountCode}>
              <TableCell>
                <span className="font-mono text-xs">{r.accountCode}</span>{' '}
                <span className="ml-2">{r.accountName}</span>
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {r.debitPaise > 0n ? formatINR(r.debitPaise) : '—'}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {r.creditPaise > 0n ? formatINR(r.creditPaise) : '—'}
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="bg-muted/20 font-medium">
            <TableCell>
              Totals
              <span className="ml-2">
                {balanced ? (
                  <StatusBadge tone="success" label="Balanced" dot={false} />
                ) : (
                  <StatusBadge tone="danger" label="Unbalanced" dot={false} />
                )}
              </span>
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {formatINR(totalDebit)}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {formatINR(totalCredit)}
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
