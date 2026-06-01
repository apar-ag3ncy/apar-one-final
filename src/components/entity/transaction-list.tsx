'use client';

import {
  AlertTriangleIcon,
  ChevronRightIcon,
  EraserIcon,
  FilterIcon,
  PlusIcon,
  ReceiptIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { formatINR } from '@/components/shared/format-inr';
import { cn } from '@/lib/utils';
import { EntityRef } from './entity-ref';
import type { NavigationTarget } from './types';

/**
 * Transaction kinds align with LEDGER-SPEC §3-§5 (five-domain model).
 * Open union so backend can extend without redeploying the UI.
 */
export type TransactionKind =
  | 'vendor_bill'
  | 'client_invoice'
  | 'payment_received'
  | 'payment_made'
  | 'advance_received'
  | 'advance_paid'
  | 'expense_on_behalf'
  | 'employee_reimbursement'
  | 'office_expense'
  | 'inter_bank_transfer'
  | 'partner_capital'
  | 'partner_drawing'
  | 'journal_voucher'
  | 'salary_run'
  | 'asset_purchase'
  | (string & {});

export type TransactionStatus =
  | 'draft'
  | 'pending_approval'
  | 'posted'
  | 'reversed'
  | 'void'
  | (string & {});

/**
 * Counterparty reference shown in the table. Use the same NavigationTarget
 * shape so EntityRef can navigate directly.
 */
export type TransactionCounterparty = {
  type: 'client' | 'vendor' | 'employee' | 'project';
  id: string;
  label: string;
};

export type Transaction = {
  id: string;
  /** Display number ("V-INV-25/04/0123"). */
  reference: string;
  kind: TransactionKind;
  date: string | Date;
  /**
   * Headline amount in paise (bigint). The sign convention is:
   *   - positive for amounts increasing this entity's payable/receivable
   *   - negative for reversals
   * Surfaces (Dashboard / OS) decide how to color/label.
   */
  amount: bigint;
  status: TransactionStatus;
  counterparty?: TransactionCounterparty | null;
  /** Short memo / narration. */
  memo?: string | null;
  /** Validation flags that prevented posting or warrant attention. */
  flags?: {
    blocks: number;
    warnings: number;
  } | null;
};

const STATUS_TONES: Record<string, StatusTone> = {
  draft: 'neutral',
  pending_approval: 'warning',
  posted: 'success',
  reversed: 'danger',
  void: 'neutral',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  posted: 'Posted',
  reversed: 'Reversed',
  void: 'Void',
};

const KIND_LABELS: Record<string, string> = {
  vendor_bill: 'Vendor bill',
  client_invoice: 'Client invoice',
  payment_received: 'Payment received',
  payment_made: 'Payment made',
  advance_received: 'Advance received',
  advance_paid: 'Advance paid',
  expense_on_behalf: 'Expense on behalf',
  employee_reimbursement: 'Reimbursement',
  office_expense: 'Office expense',
  inter_bank_transfer: 'Inter-bank transfer',
  partner_capital: 'Partner capital',
  partner_drawing: 'Partner drawing',
  journal_voucher: 'Journal voucher',
  salary_run: 'Salary run',
  asset_purchase: 'Asset purchase',
};

export type TransactionListProps = {
  transactions: readonly Transaction[];
  /**
   * Empty-state copy mode. "all" = the global ledger; "entity" = scoped to a
   * single entity's tab; "kind" = filtered to a single kind.
   */
  scope?: 'all' | 'entity' | 'kind';
  entityName?: string;
  /** Click handler — typically opens the detail viewer in a sheet/window. */
  onSelectTransaction?: (transaction: Transaction) => void;
  /** Navigate to a counterparty (passed through to inline EntityRef). */
  onNavigate?: (target: NavigationTarget) => void;
  /** "New transaction" CTA on the header. */
  onCreate?: () => void;
  /**
   * Bulk reverse callback. Verb is **Reverse**, never **Delete** for posted
   * transactions (amendment §2.1). Only the consumer knows the user's
   * capability; if absent, the checkbox column is hidden.
   */
  onReverseSelected?: (transactionIds: readonly string[]) => void;
  /** Currently-selected ids (controlled bulk selection). */
  selectedIds?: readonly string[];
  onSelectionChange?: (ids: readonly string[]) => void;
  className?: string;
};

export function TransactionList({
  transactions,
  scope = 'entity',
  entityName,
  onSelectTransaction,
  onNavigate,
  onCreate,
  onReverseSelected,
  selectedIds,
  onSelectionChange,
  className,
}: TransactionListProps) {
  const allowSelection = Boolean(onReverseSelected && onSelectionChange);
  const selectedSet = new Set(selectedIds ?? []);
  const allOnPageSelected =
    transactions.length > 0 &&
    transactions.every((t) => selectedSet.has(t.id) && t.status === 'posted');
  const someSelected = selectedSet.size > 0;

  if (transactions.length === 0) {
    return (
      <EmptyState
        icon={ReceiptIcon}
        title={
          scope === 'entity' && entityName
            ? `No transactions for ${entityName} yet`
            : 'No transactions yet'
        }
        description="Transactions appear here once you create a vendor bill, client invoice, payment, or other posting. Drafts and posted entries both show."
        action={
          onCreate ? (
            <Button size="sm" onClick={onCreate}>
              <PlusIcon className="mr-1.5 size-3.5" aria-hidden />
              New transaction
            </Button>
          ) : undefined
        }
      />
    );
  }

  function toggleAll() {
    if (!onSelectionChange) return;
    if (allOnPageSelected) {
      onSelectionChange([]);
    } else {
      onSelectionChange(transactions.filter((t) => t.status === 'posted').map((t) => t.id));
    }
  }

  function toggleOne(id: string) {
    if (!onSelectionChange) return;
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(Array.from(next));
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <CardTitle className="text-base">
          Transactions
          <span className="text-muted-foreground ml-2 text-sm font-normal">
            {transactions.length}
          </span>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <FilterIcon className="size-3.5" aria-hidden />
            Filter
          </Button>
          {onCreate ? (
            <Button size="sm" onClick={onCreate}>
              <PlusIcon className="mr-1.5 size-3.5" aria-hidden />
              New
            </Button>
          ) : null}
        </div>
      </CardHeader>

      {allowSelection && someSelected ? (
        <div className="bg-muted/40 flex items-center justify-between gap-2 border-y px-4 py-2 text-sm">
          <span>
            {selectedSet.size} selected{' '}
            <span className="text-muted-foreground">
              · only posted transactions can be reversed
            </span>
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onSelectionChange?.([])}>
              Clear
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => onReverseSelected?.(Array.from(selectedSet))}
            >
              <EraserIcon className="size-3.5" aria-hidden />
              Reverse selected
            </Button>
          </div>
        </div>
      ) : null}

      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              {allowSelection ? (
                <TableHead className="w-10 px-4">
                  <Checkbox
                    checked={allOnPageSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all posted transactions"
                  />
                </TableHead>
              ) : null}
              <TableHead className="px-4">Date</TableHead>
              <TableHead className="px-4">Reference</TableHead>
              <TableHead className="px-4">Kind</TableHead>
              <TableHead className="px-4">Counterparty</TableHead>
              <TableHead className="px-4">Memo</TableHead>
              <TableHead className="px-4 text-right">Amount</TableHead>
              <TableHead className="px-4">Status</TableHead>
              <TableHead className="w-10 px-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((t) => {
              const isPosted = t.status === 'posted';
              const isSelected = selectedSet.has(t.id);
              return (
                <TableRow
                  key={t.id}
                  className={cn(
                    onSelectTransaction && 'cursor-pointer',
                    isSelected && 'bg-primary/5',
                  )}
                  onClick={onSelectTransaction ? () => onSelectTransaction(t) : undefined}
                >
                  {allowSelection ? (
                    <TableCell className="px-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        disabled={!isPosted}
                        onCheckedChange={() => toggleOne(t.id)}
                        aria-label={`Select ${t.reference}`}
                      />
                    </TableCell>
                  ) : null}
                  <TableCell className="text-muted-foreground px-4 text-xs whitespace-nowrap">
                    {formatShortDate(t.date)}
                  </TableCell>
                  <TableCell className="px-4 font-mono text-sm">{t.reference}</TableCell>
                  <TableCell className="text-muted-foreground px-4 text-sm">
                    {KIND_LABELS[t.kind] ?? t.kind}
                  </TableCell>
                  <TableCell className="px-4 text-sm">
                    {t.counterparty ? (
                      <EntityRef
                        type={t.counterparty.type}
                        id={t.counterparty.id}
                        label={t.counterparty.label}
                        onNavigate={onNavigate}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-xs truncate px-4 text-sm">
                    {t.memo ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="px-4 text-right font-mono text-sm tabular-nums">
                    {formatINR(t.amount)}
                  </TableCell>
                  <TableCell className="px-4">
                    <div className="flex items-center gap-1.5">
                      <StatusBadge
                        tone={STATUS_TONES[t.status] ?? 'neutral'}
                        label={STATUS_LABELS[t.status] ?? t.status}
                      />
                      {t.flags && (t.flags.blocks > 0 || t.flags.warnings > 0) ? (
                        <span
                          className="text-amber-600"
                          aria-label={`${t.flags.blocks} blocking, ${t.flags.warnings} warning`}
                          title={`${t.flags.blocks} blocking, ${t.flags.warnings} warning flags`}
                        >
                          <AlertTriangleIcon className="size-3.5" aria-hidden />
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="px-4">
                    {onSelectTransaction ? (
                      <ChevronRightIcon className="text-muted-foreground size-3.5" aria-hidden />
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function formatShortDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}
