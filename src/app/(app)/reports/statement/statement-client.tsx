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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatINR } from '@/components/shared/format-inr';
import { ExportMenu } from '@/components/shared/export-menu';
import { EntityRef } from '@/components/entity/entity-ref';
import { useEntityNavigate } from '@/lib/client/use-navigate';
import { exportRows, paiseToRupees, type ExportFormat } from '@/lib/client/export-rows';
import type { StatementRow } from '@/lib/server-stub/ledger-types';

export type StatementClientProps = {
  side: 'client' | 'vendor';
  id: string | undefined;
  fromDate: string;
  toDate: string;
  rows: readonly StatementRow[];
  clients: readonly { id: string; name: string }[];
  vendors: readonly { id: string; name: string }[];
};

export function StatementClient({
  side,
  id,
  fromDate,
  toDate,
  rows,
  clients,
  vendors,
}: StatementClientProps) {
  const router = useRouter();
  const onNavigate = useEntityNavigate();

  function apply(params: { side?: string; id?: string; from?: string; to?: string }) {
    const next = new URLSearchParams();
    next.set('side', params.side ?? side);
    if (params.id ?? id) next.set('id', params.id ?? id ?? '');
    next.set('from', params.from ?? fromDate);
    next.set('to', params.to ?? toDate);
    router.push(`/reports/statement?${next.toString()}`);
  }

  function handleExport(format: ExportFormat) {
    const headers = [
      'Date',
      'Document no.',
      'Party',
      'Bank / cash account',
      'Particulars',
      'Kind',
      'Debit',
      'Credit',
      'Balance',
    ];
    const data: Record<string, string | number>[] = rows.map((r) => ({
      Date: r.date,
      'Document no.': r.documentNumber ?? r.reference,
      Party: r.counterpartyName ?? '',
      'Bank / cash account': r.bankAccountLabel ?? '',
      Particulars: r.memo ?? '',
      Kind: r.kind,
      Debit: paiseToRupees(r.debitPaise),
      Credit: paiseToRupees(r.creditPaise),
      Balance: paiseToRupees(r.runningBalancePaise),
    }));
    exportRows(
      data,
      headers,
      `statement-${side}-${id}-${fromDate}-${toDate}`,
      format,
      'Statement',
      {
        columnFormats: { Balance: '+#,##0.00;-#,##0.00;0.00' },
      },
    );
  }

  const options = side === 'client' ? clients : vendors;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end gap-3 pb-3">
          <Tabs value={side} onValueChange={(v) => apply({ side: v })}>
            <TabsList>
              <TabsTrigger value="client">Client</TabsTrigger>
              <TabsTrigger value="vendor">Vendor</TabsTrigger>
            </TabsList>
          </Tabs>
          <div>
            <Label className="text-muted-foreground text-xs tracking-wide uppercase">
              {side === 'client' ? 'Client' : 'Vendor'}
            </Label>
            <Select value={id ?? ''} onValueChange={(v) => apply({ id: v })}>
              <SelectTrigger className="min-w-[12rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {opt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-muted-foreground text-xs tracking-wide uppercase">From</Label>
            <Input
              type="date"
              defaultValue={fromDate}
              onChange={(e) => apply({ from: e.target.value })}
              className="w-44"
            />
          </div>
          <div>
            <Label className="text-muted-foreground text-xs tracking-wide uppercase">To</Label>
            <Input
              type="date"
              defaultValue={toDate}
              onChange={(e) => apply({ to: e.target.value })}
              className="w-44"
            />
          </div>
          <div className="ml-auto">
            <ExportMenu onExport={handleExport} disabled={rows.length === 0} />
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Postings</CardTitle>
          {id ? (
            <EntityRef
              type={side}
              id={id}
              label="Open profile"
              hideIcon
              onNavigate={onNavigate}
              className="text-xs"
            />
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              No postings in this range.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Date</TableHead>
                  <TableHead>Particulars</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.transactionId} className="hover:bg-muted/40">
                    {/* Read-only: no dashboard transaction-detail route exists to
                        drill into (the OS ledger window provides drill-down). */}
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                      {r.date}
                    </TableCell>
                    <TableCell className="max-w-xs text-sm">
                      <div className="font-mono break-words [overflow-wrap:anywhere]">
                        {r.documentNumber ?? r.memo ?? r.reference}
                      </div>
                      {r.memo && r.documentNumber ? (
                        <div className="text-muted-foreground text-xs break-words [overflow-wrap:anywhere]">
                          {r.memo}
                        </div>
                      ) : null}
                      {r.bankAccountLabel ? (
                        <div className="text-muted-foreground font-mono text-xs break-words [overflow-wrap:anywhere]">
                          via {r.bankAccountLabel}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">{r.counterpartyName ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{r.kind}</TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {r.debitPaise > 0n ? formatINR(r.debitPaise) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {r.creditPaise > 0n ? formatINR(r.creditPaise) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {formatINR(r.runningBalancePaise)}
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
