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
import { exportRows, paiseToRupees, type ExportFormat } from '@/lib/client/export-rows';
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

  function handleExport(format: ExportFormat) {
    const headers = ['Code', 'Account', 'Debit', 'Credit'];
    const data: Record<string, string | number>[] = rows.map((r) => ({
      Code: r.accountCode,
      Account: r.accountName,
      Debit: paiseToRupees(r.debitPaise),
      Credit: paiseToRupees(r.creditPaise),
    }));
    data.push({
      Code: '',
      Account: 'Totals',
      Debit: paiseToRupees(totalDebit),
      Credit: paiseToRupees(totalCredit),
    });
    exportRows(data, headers, `trial-balance-${asOfDate}`, format, 'Trial Balance');
  }

  return (
    <ReportShell
      asOfDate={asOfDate}
      includeReversed={includeReversed}
      showIncludeReversed
      basePath="/reports/trial-balance"
      onExport={handleExport}
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
