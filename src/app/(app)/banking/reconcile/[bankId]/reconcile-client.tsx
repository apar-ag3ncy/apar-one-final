'use client';

import { useState } from 'react';
import { CheckCircle2Icon, CircleAlertIcon, LinkIcon, PlusIcon, UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import type { ReconciliationRow } from '@/lib/server-stub/ledger-types';

export function ReconcileClient({
  bankId,
  initialRows,
}: {
  bankId: string;
  initialRows: readonly ReconciliationRow[];
}) {
  const [rows, setRows] = useState<ReconciliationRow[]>(() => initialRows.map((r) => ({ ...r })));
  const [statementUploaded, setStatementUploaded] = useState(false);

  const matched = rows.filter(
    (r) => r.status === 'matched' || r.status === 'manual_match' || r.status === 'newly_created',
  ).length;
  const unmatched = rows.filter((r) => r.status === 'unmatched').length;
  const allDone = unmatched === 0 && rows.length > 0;

  function markManualMatch(idx: number, transactionId: string) {
    const next = rows.slice();
    next[idx] = { ...next[idx]!, status: 'manual_match', matchedTransactionId: transactionId };
    setRows(next);
  }

  function createTransactionFor(idx: number) {
    // TODO(backend): open the office-expense form pre-filled from the bank row.
    const next = rows.slice();
    next[idx] = {
      ...next[idx]!,
      status: 'newly_created',
      matchedTransactionId: 'tx_pending_' + Math.random().toString(36).slice(2, 8),
    };
    setRows(next);
  }

  if (!statementUploaded) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <UploadIcon className="text-muted-foreground size-8" aria-hidden />
          <h2 className="text-lg font-medium">
            Upload statement for bank <span className="font-mono">{bankId}</span>
          </h2>
          <p className="text-muted-foreground max-w-md text-sm">
            CSV or PDF from the bank. We&apos;ll OCR PDFs, auto-match by amount/date/UTR, then show
            you what remains.
          </p>
          <Button onClick={() => setStatementUploaded(true)}>
            <UploadIcon className="mr-1.5 size-3.5" aria-hidden />
            Simulate upload (Backend ingestion not yet shipped)
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
          <div className="space-y-1">
            <CardTitle className="text-base">Reconciliation progress</CardTitle>
            <p className="text-muted-foreground text-xs">
              {matched} matched · {unmatched} unmatched · {rows.length} rows total
            </p>
          </div>
          <Button disabled title={allDone ? 'Finalising reconciliation — coming soon.' : undefined}>
            {allDone ? (
              <>
                <CheckCircle2Icon className="mr-1.5 size-3.5" aria-hidden />
                Mark complete
              </>
            ) : (
              `Resolve ${unmatched} unmatched row${unmatched === 1 ? '' : 's'}`
            )}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Date</TableHead>
                <TableHead>Bank description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Match</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, idx) => (
                <TableRow key={idx}>
                  <TableCell className="text-muted-foreground text-xs">{r.bank.date}</TableCell>
                  <TableCell className="text-sm">{r.bank.description}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatINR(r.bank.amountPaise)}
                  </TableCell>
                  <TableCell>
                    {r.status === 'matched' ? (
                      <StatusBadge tone="success" label="Auto-matched" dot={false} />
                    ) : r.status === 'manual_match' ? (
                      <StatusBadge tone="info" label="Manual match" dot={false} />
                    ) : r.status === 'newly_created' ? (
                      <StatusBadge tone="accent" label="Created" dot={false} />
                    ) : (
                      <StatusBadge tone="warning" label="Unmatched" />
                    )}
                  </TableCell>
                  <TableCell>
                    {r.matchedTransactionId ? (
                      <span className="inline-flex items-center gap-1 font-mono text-xs">
                        <LinkIcon className="size-3 opacity-60" aria-hidden />
                        {r.matchedTransactionId}
                      </span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => markManualMatch(idx, 'tx_manual_' + idx)}
                        >
                          <LinkIcon className="mr-1 size-3" aria-hidden />
                          Match
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => createTransactionFor(idx)}
                        >
                          <PlusIcon className="mr-1 size-3" aria-hidden />
                          Create
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center gap-2 py-3 text-xs">
          <CircleAlertIcon className="text-muted-foreground size-3.5" aria-hidden />
          <span className="text-muted-foreground">
            Reconciliation persistence + statement parsing land when Backend ships
            `parseBankStatement` and `reconcileBankBatch`. The UI is wired so once the data layer
            connects, no component changes are needed.
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
