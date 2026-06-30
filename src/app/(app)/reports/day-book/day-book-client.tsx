'use client';

import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatINR } from '@/components/shared/format-inr';
import { ExportMenu } from '@/components/shared/export-menu';
import { exportRows, paiseToRupees, type ExportFormat } from '@/lib/client/export-rows';
import type { DayBookEntry } from '@/lib/server/ledger/statements';

export function DayBookClient({
  from,
  to,
  entries,
}: {
  from: string;
  to: string;
  entries: readonly DayBookEntry[];
}) {
  const router = useRouter();

  function apply(p: { from?: string; to?: string }) {
    const next = new URLSearchParams();
    next.set('from', p.from ?? from);
    next.set('to', p.to ?? to);
    router.push(`/reports/day-book?${next.toString()}`);
  }

  function handleExport(format: ExportFormat) {
    const headers = ['Date', 'Reference', 'Kind', 'Account', 'Debit', 'Credit'];
    const data = entries.map((e) => ({
      Date: e.txnDate,
      Reference: e.reference,
      Kind: e.kind,
      Account: `${e.accountCode} ${e.accountName}`,
      Debit: e.side === 'debit' ? paiseToRupees(e.amountPaise) : 0,
      Credit: e.side === 'credit' ? paiseToRupees(e.amountPaise) : 0,
    }));
    exportRows(data, headers, `day-book-${from}-${to}`, format, 'Day book');
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end gap-3 pb-3">
          <div>
            <Label className="text-muted-foreground text-xs tracking-wide uppercase">From</Label>
            <Input
              type="date"
              defaultValue={from}
              onChange={(e) => apply({ from: e.target.value })}
              className="w-44"
            />
          </div>
          <div>
            <Label className="text-muted-foreground text-xs tracking-wide uppercase">To</Label>
            <Input
              type="date"
              defaultValue={to}
              onChange={(e) => apply({ to: e.target.value })}
              className="w-44"
            />
          </div>
          <div className="ml-auto">
            <ExportMenu onExport={handleExport} disabled={entries.length === 0} />
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Postings{' '}
            <span className="text-muted-foreground text-xs font-normal">({entries.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              No postings in this range.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Date</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.postingId} className="hover:bg-muted/40">
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                      {e.txnDate}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{e.reference}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{e.kind}</TableCell>
                    <TableCell className="text-xs">
                      <span className="font-mono">{e.accountCode}</span> {e.accountName}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {e.side === 'debit' ? formatINR(e.amountPaise) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {e.side === 'credit' ? formatINR(e.amountPaise) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
