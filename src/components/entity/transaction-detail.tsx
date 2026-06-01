'use client';

import { AlertTriangleIcon, FileTextIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { formatINR } from '@/components/shared/format-inr';
import { EntityRef } from './entity-ref';
import type { NavigationTarget } from './types';
import type { Transaction, TransactionStatus } from './transaction-list';

/**
 * One side of a double-entry posting (debit OR credit). Aligns with
 * LEDGER-SPEC §3.
 */
export type TransactionPosting = {
  id: string;
  /** Account number (e.g. "1100", "4100"). */
  accountCode: string;
  /** Human-readable name ("Trade Receivables – Domestic"). */
  accountName: string;
  /** Domain from LEDGER-SPEC §5 — "operating" | "owners" | "tax" | "cogs" | "non_op". */
  domain?: string | null;
  /** Debit amount in paise. Mutually exclusive with credit. */
  debit?: bigint | null;
  /** Credit amount in paise. */
  credit?: bigint | null;
  /** Optional dimension reference (e.g. client, project, employee). */
  dimensionRef?: {
    type: 'client' | 'vendor' | 'employee' | 'project';
    id: string;
    label: string;
  } | null;
  memo?: string | null;
};

export type TransactionFlag = {
  id: string;
  /** "block" prevents posting; "warn" allows posting after acknowledgement. */
  severity: 'block' | 'warn' | 'info';
  /** Short headline shown in the badge. */
  code: string;
  /** Longer text shown in the details list. */
  message: string;
  /** Whether the user has acknowledged this warn flag. */
  acknowledged?: boolean;
};

export type TransactionDetailData = Transaction & {
  postings: readonly TransactionPosting[];
  flags?: readonly TransactionFlag[] | null;
  /** Source document ids attached to this transaction (rendered below). */
  sourceDocumentIds?: readonly string[];
  /** Free-text reason for journal vouchers / reversals. */
  reason?: string | null;
};

export type TransactionDetailProps = {
  transaction: TransactionDetailData;
  /** Inline document viewer slot — typically rendered as <DocumentViewer />. */
  sourceDocumentSlot?: React.ReactNode;
  /** Acknowledge callback for warn flags. */
  onAcknowledgeFlag?: (flagId: string) => void;
  /** Navigate callback for inline EntityRefs. */
  onNavigate?: (target: NavigationTarget) => void;
  className?: string;
};

const STATUS_TONES: Record<TransactionStatus, StatusTone> = {
  draft: 'neutral',
  pending_approval: 'warning',
  posted: 'success',
  reversed: 'danger',
  void: 'neutral',
};

const STATUS_LABELS: Record<TransactionStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  posted: 'Posted',
  reversed: 'Reversed',
  void: 'Void',
};

/**
 * Renders a single transaction with its full double-entry postings, validation
 * flags, and (optionally) the source document inline.
 *
 * Pure presentational. Posting/reversing logic lives in server actions; this
 * component only displays the resolved data.
 */
export function TransactionDetail({
  transaction,
  sourceDocumentSlot,
  onAcknowledgeFlag,
  onNavigate,
  className,
}: TransactionDetailProps) {
  const { postings, flags, reason } = transaction;

  const debitTotal = postings.reduce((sum, p) => sum + (p.debit ?? 0n), 0n);
  const creditTotal = postings.reduce((sum, p) => sum + (p.credit ?? 0n), 0n);
  const balanced = debitTotal === creditTotal;

  return (
    <div className={className}>
      <header className="flex flex-col gap-2 pb-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-lg font-semibold">{transaction.reference}</h2>
            <StatusBadge
              tone={STATUS_TONES[transaction.status as TransactionStatus] ?? 'neutral'}
              label={STATUS_LABELS[transaction.status as TransactionStatus] ?? transaction.status}
            />
          </div>
          <p className="text-muted-foreground text-sm">
            {formatLongDate(transaction.date)}
            {transaction.counterparty ? (
              <>
                {' · '}
                <EntityRef
                  type={transaction.counterparty.type}
                  id={transaction.counterparty.id}
                  label={transaction.counterparty.label}
                  onNavigate={onNavigate}
                />
              </>
            ) : null}
          </p>
        </div>
        <div className="font-mono text-xl tabular-nums">{formatINR(transaction.amount)}</div>
      </header>

      {flags && flags.length > 0 ? (
        <Card className="mb-4 border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangleIcon className="size-4 text-amber-600" aria-hidden />
              Validation flags
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {flags.map((flag) => (
              <div
                key={flag.id}
                className="flex items-start justify-between gap-3 border-t pt-2 first:border-t-0 first:pt-0"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusBadge
                      tone={flag.severity === 'block' ? 'danger' : 'warning'}
                      label={flag.severity.toUpperCase()}
                      dot={false}
                    />
                    <span className="font-mono text-xs">{flag.code}</span>
                  </div>
                  <p className="text-muted-foreground mt-0.5 text-xs">{flag.message}</p>
                </div>
                {flag.severity === 'warn' && onAcknowledgeFlag ? (
                  <label className="flex shrink-0 items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={Boolean(flag.acknowledged)}
                      onChange={() => onAcknowledgeFlag(flag.id)}
                    />
                    Acknowledge
                  </label>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Postings</CardTitle>
          {!balanced ? (
            <StatusBadge tone="danger" label="Unbalanced" />
          ) : (
            <span className="text-muted-foreground text-xs">
              {postings.length} {postings.length === 1 ? 'entry' : 'entries'} · balanced
            </span>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="px-4">Account</TableHead>
                <TableHead className="px-4">Dimension</TableHead>
                <TableHead className="px-4">Memo</TableHead>
                <TableHead className="px-4 text-right">Debit</TableHead>
                <TableHead className="px-4 text-right">Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {postings.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="px-4">
                    <div className="font-mono text-xs">{p.accountCode}</div>
                    <div className="text-sm">{p.accountName}</div>
                  </TableCell>
                  <TableCell className="px-4 text-sm">
                    {p.dimensionRef ? (
                      <EntityRef
                        type={p.dimensionRef.type}
                        id={p.dimensionRef.id}
                        label={p.dimensionRef.label}
                        onNavigate={onNavigate}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-xs truncate px-4 text-sm">
                    {p.memo ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="px-4 text-right font-mono text-sm tabular-nums">
                    {p.debit ? (
                      formatINR(p.debit)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="px-4 text-right font-mono text-sm tabular-nums">
                    {p.credit ? (
                      formatINR(p.credit)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/20 font-medium">
                <TableCell colSpan={3} className="px-4 text-right">
                  Totals
                </TableCell>
                <TableCell className="px-4 text-right font-mono tabular-nums">
                  {formatINR(debitTotal)}
                </TableCell>
                <TableCell className="px-4 text-right font-mono tabular-nums">
                  {formatINR(creditTotal)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {reason ? (
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Reason</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm whitespace-pre-wrap">{reason}</p>
          </CardContent>
        </Card>
      ) : null}

      {sourceDocumentSlot ? (
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileTextIcon className="size-4 opacity-70" aria-hidden />
              Source document
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[480px] p-0 md:h-[640px]">{sourceDocumentSlot}</CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function formatLongDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
