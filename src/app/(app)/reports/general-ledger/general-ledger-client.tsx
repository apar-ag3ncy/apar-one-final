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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatINR } from '@/components/shared/format-inr';
import { ExportMenu } from '@/components/shared/export-menu';
import { exportRows, paiseToRupees, type ExportFormat } from '@/lib/client/export-rows';
import type { Statement } from '@/lib/server/ledger/statements';

export function GeneralLedgerClient({
  account,
  from,
  to,
  accounts,
  statement,
}: {
  account: string | undefined;
  from: string;
  to: string;
  accounts: ReadonlyArray<{ code: string; name: string; type: string }>;
  statement: Statement;
}) {
  const router = useRouter();

  function apply(p: { account?: string; from?: string; to?: string }) {
    const next = new URLSearchParams();
    if (p.account ?? account) next.set('account', p.account ?? account ?? '');
    next.set('from', p.from ?? from);
    next.set('to', p.to ?? to);
    router.push(`/reports/general-ledger?${next.toString()}`);
  }

  function handleExport(format: ExportFormat) {
    const headers = ['Date', 'Reference', 'Kind', 'Debit', 'Credit', 'Running balance'];
    const data = statement.lines.map((l) => ({
      Date: l.txnDate,
      Reference: l.reference,
      Kind: l.kind,
      Debit: l.side === 'debit' ? paiseToRupees(l.amountPaise) : 0,
      Credit: l.side === 'credit' ? paiseToRupees(l.amountPaise) : 0,
      'Running balance': paiseToRupees(l.runningBalancePaise),
    }));
    exportRows(data, headers, `general-ledger-${account}-${from}-${to}`, format, 'General ledger');
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end gap-3 pb-3">
          <div>
            <Label className="text-muted-foreground text-xs tracking-wide uppercase">Account</Label>
            <Select value={account ?? ''} onValueChange={(v) => apply({ account: v })}>
              <SelectTrigger className="min-w-[16rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.code} value={a.code}>
                    {a.code} · {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
            <ExportMenu onExport={handleExport} disabled={statement.lines.length === 0} />
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Postings</CardTitle>
          <span className="text-muted-foreground text-sm">
            Closing balance:{' '}
            <span className="text-foreground font-mono font-medium tabular-nums">
              {formatINR(statement.closingBalancePaise)}
            </span>
          </span>
        </CardHeader>
        <CardContent className="p-0">
          {statement.lines.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              No postings on this account in this range.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Date</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Running</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statement.lines.map((l) => (
                  <TableRow key={l.postingId} className="hover:bg-muted/40">
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                      {l.txnDate}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{l.reference}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{l.kind}</TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {l.side === 'debit' ? formatINR(l.amountPaise) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {l.side === 'credit' ? formatINR(l.amountPaise) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {formatINR(l.runningBalancePaise)}
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
