'use client';

import * as React from 'react';
import {
  AlertTriangleIcon,
  CalendarIcon,
  CheckCircleIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileXIcon,
  ReceiptIcon,
  SendIcon,
} from 'lucide-react';

import { EntityRef } from '@/components/entity/entity-ref';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/shared/empty-state';
import { formatINR } from '@/components/shared/format-inr';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';

import type { Invoice, InvoiceLine, InvoiceState, NavigationTarget, ValidationFlag } from './types';

export type InvoiceDetailProps = {
  invoice: Invoice | null;
  loading?: boolean;
  onNavigate?: (target: NavigationTarget) => void;
  /** Header action handlers — host wires these. */
  onSendClick?: (invoiceId: string) => void;
  onVoidClick?: (invoiceId: string) => void;
  onDuplicateClick?: (invoiceId: string) => void;
  onCreateCreditNoteClick?: (invoiceId: string) => void;
  /** Capability gates — actions with `false` are hidden. */
  capabilities?: {
    canSend?: boolean;
    canVoid?: boolean;
    canDuplicate?: boolean;
    canCreateCreditNote?: boolean;
  };
  /** Acknowledge a warn-severity validation flag. */
  onAcknowledgeFlag?: (flagCode: string) => void;
  /** Render the existing `<DocumentViewer />` here. Dashboard passes the inline viewer; OS passes its window-wrapper. */
  documentViewerSlot?: React.ReactNode;
  className?: string;
};

const STATE_TONE: Record<InvoiceState, StatusTone> = {
  draft: 'neutral',
  sent: 'info',
  partially_paid: 'warning',
  paid: 'success',
  void: 'danger',
};

const STATE_LABEL: Record<InvoiceState, string> = {
  draft: 'Draft',
  sent: 'Sent',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  void: 'Void',
};

/**
 * C1.2 — Read-only invoice view.
 *
 * Layout:
 *   1. Header card  — number, party, dates, state badge, totals, header actions
 *   2. Validation flags banner (when present)
 *   3. Line items table
 *   4. Captured tax split panel
 *   5. Linked credit notes + receipts (EntityRef rows)
 *   6. Source document viewer slot (host-provided)
 *
 * Dumb-component contract:
 *   - No data fetching here. The host passes `invoice` already enriched
 *     (joined with party label, totals derived).
 *   - All mutations leave via callbacks (`onSendClick`, etc.).
 *   - No `next/navigation` — navigation through `onNavigate`.
 */
export function InvoiceDetail({
  invoice,
  loading,
  onNavigate,
  onSendClick,
  onVoidClick,
  onDuplicateClick,
  onCreateCreditNoteClick,
  capabilities,
  onAcknowledgeFlag,
  documentViewerSlot,
  className,
}: InvoiceDetailProps) {
  if (loading) {
    return (
      <div className={cn('space-y-4', className)}>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!invoice) {
    return (
      <EmptyState
        icon={ReceiptIcon}
        title="Invoice not found"
        description="It may have been voided or you may not have access."
      />
    );
  }

  const stateTone = STATE_TONE[invoice.state];
  const stateLabel = STATE_LABEL[invoice.state];
  const isPosted = invoice.state !== 'draft' && invoice.state !== 'void';

  return (
    <div className={cn('space-y-6', className)}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <CardTitle className="text-xl font-semibold">{invoice.document_number}</CardTitle>
              <StatusBadge tone={stateTone} label={stateLabel} />
            </div>
            <div className="text-muted-foreground text-sm">
              To{' '}
              <EntityRef
                type={invoice.party.type}
                id={invoice.party.id}
                label={invoice.party.label}
                tab={invoice.party.tab}
                onNavigate={onNavigate}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {capabilities?.canSend !== false && invoice.state === 'draft' && onSendClick ? (
              <Button type="button" size="sm" onClick={() => onSendClick(invoice.id)}>
                <SendIcon className="size-4" aria-hidden />
                Send
              </Button>
            ) : null}
            {capabilities?.canDuplicate !== false && onDuplicateClick ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onDuplicateClick(invoice.id)}
              >
                <CopyIcon className="size-4" aria-hidden />
                Duplicate
              </Button>
            ) : null}
            {capabilities?.canCreateCreditNote !== false && isPosted && onCreateCreditNoteClick ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onCreateCreditNoteClick(invoice.id)}
              >
                <ExternalLinkIcon className="size-4" aria-hidden />
                Credit note
              </Button>
            ) : null}
            {capabilities?.canVoid && invoice.state !== 'void' && onVoidClick ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => onVoidClick(invoice.id)}
              >
                <FileXIcon className="size-4" aria-hidden />
                Void
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <MetaField label="Invoice date" icon={<CalendarIcon className="size-3.5" aria-hidden />}>
            {invoice.document_date}
          </MetaField>
          <MetaField label="Due date" icon={<CalendarIcon className="size-3.5" aria-hidden />}>
            {invoice.due_date}
          </MetaField>
          <MetaField label="Place of supply">
            {invoice.place_of_supply}{' '}
            <span className="text-muted-foreground text-xs">
              ({invoice.place_of_supply_kind === 'intra_state' ? 'CGST+SGST' : 'IGST'})
            </span>
          </MetaField>
          <MetaField label="Captured total" align="right">
            <span className="font-semibold tabular-nums">
              {formatINR(invoice.captured_total_paise)}
            </span>
          </MetaField>
          <MetaField label="Subtotal" align="right">
            <span className="tabular-nums">{formatINR(invoice.subtotal_paise)}</span>
          </MetaField>
          <MetaField label="Tax" align="right">
            <span className="tabular-nums">{formatINR(invoice.captured_tax_total_paise)}</span>
          </MetaField>
          <MetaField label="Paid" align="right">
            <span className="tabular-nums">{formatINR(invoice.paid_paise)}</span>
          </MetaField>
          <MetaField label="Balance" align="right">
            <span
              className={cn(
                'tabular-nums',
                invoice.balance_paise > 0n && 'font-semibold text-amber-700 dark:text-amber-300',
              )}
            >
              {formatINR(invoice.balance_paise)}
            </span>
          </MetaField>
        </CardContent>
      </Card>

      <ValidationFlagsBanner flags={invoice.validation_flags} onAcknowledge={onAcknowledgeFlag} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Line items</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-24">SAC</TableHead>
                <TableHead className="w-20 text-right">Qty</TableHead>
                <TableHead className="w-32 text-right">Rate</TableHead>
                <TableHead className="w-32 text-right">Taxable</TableHead>
                <TableHead className="w-24 text-right">Tax</TableHead>
                <TableHead className="w-16 text-right">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.lines.map((line) => (
                <LineRow key={line.id} line={line} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CapturedTaxSplitPanel invoice={invoice} />

      <LinkedDocuments invoice={invoice} onNavigate={onNavigate} />

      {documentViewerSlot ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Source document</CardTitle>
          </CardHeader>
          <CardContent>{documentViewerSlot}</CardContent>
        </Card>
      ) : null}

      {invoice.notes ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap">{invoice.notes}</CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function MetaField({
  label,
  icon,
  children,
  align,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <div className={cn('flex flex-col gap-0.5', align === 'right' && 'text-right')}>
      <span className="text-muted-foreground flex items-center gap-1 text-xs">
        {icon}
        {label}
      </span>
      <span className="text-foreground text-sm">{children}</span>
    </div>
  );
}

function LineRow({ line }: { line: InvoiceLine }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground tabular-nums">{line.line_no}</TableCell>
      <TableCell>{line.description}</TableCell>
      <TableCell className="text-muted-foreground font-mono text-xs">
        {line.sac_code ?? '—'}
      </TableCell>
      <TableCell className="text-right tabular-nums">{line.qty}</TableCell>
      <TableCell className="text-right tabular-nums">{formatINR(line.rate_paise)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {formatINR(line.captured_taxable_value_paise)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatINR(line.captured_tax_amount_paise)}
      </TableCell>
      <TableCell className="text-muted-foreground text-right tabular-nums">
        {bpsToPct(line.captured_tax_rate_bps)}
      </TableCell>
    </TableRow>
  );
}

function ValidationFlagsBanner({
  flags,
  onAcknowledge,
}: {
  flags: ValidationFlag[];
  onAcknowledge?: (code: string) => void;
}) {
  if (!flags || flags.length === 0) return null;
  const unacknowledged = flags.filter((f) => !f.acknowledged_at);
  if (unacknowledged.length === 0) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-900/20"
    >
      <div className="flex items-start gap-2">
        <AlertTriangleIcon
          className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300"
          aria-hidden
        />
        <div className="flex-1 space-y-2">
          <div className="text-sm font-medium text-amber-900 dark:text-amber-100">
            {unacknowledged.length === 1
              ? '1 validation warning'
              : `${unacknowledged.length} validation warnings`}
          </div>
          <ul className="space-y-1 text-xs text-amber-900 dark:text-amber-200">
            {unacknowledged.map((f) => (
              <li key={f.code} className="flex items-center justify-between gap-3">
                <span>
                  <span className="font-mono">{f.code}</span> — {f.message}
                </span>
                {onAcknowledge ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => onAcknowledge(f.code)}
                  >
                    <CheckCircleIcon className="size-3" aria-hidden />
                    Acknowledge
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function CapturedTaxSplitPanel({ invoice }: { invoice: Invoice }) {
  const split = invoice.captured_tax_split;
  const total = invoice.captured_tax_total_paise;
  const components = [
    { label: 'CGST', paise: split.cgst_paise },
    { label: 'SGST', paise: split.sgst_paise },
    { label: 'IGST', paise: split.igst_paise },
    { label: 'Cess', paise: split.cess_paise },
  ].filter((c) => c.paise > 0n);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Captured tax split</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-4 text-sm">
          {components.length === 0 ? (
            <span className="text-muted-foreground">No tax captured.</span>
          ) : (
            components.map((c) => (
              <div key={c.label} className="flex flex-col">
                <span className="text-muted-foreground text-xs">{c.label}</span>
                <span className="tabular-nums">{formatINR(c.paise)}</span>
              </div>
            ))
          )}
          <Separator orientation="vertical" className="hidden h-10 md:block" />
          <div className="flex flex-col">
            <span className="text-muted-foreground text-xs">Captured total</span>
            <span className="font-semibold tabular-nums">{formatINR(total)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LinkedDocuments({
  invoice,
  onNavigate,
}: {
  invoice: Invoice;
  onNavigate?: (target: NavigationTarget) => void;
}) {
  const credits = invoice.linked_credit_notes;
  const receipts = invoice.linked_receipts;
  if (credits.length === 0 && receipts.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Linked documents</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {credits.length > 0 ? (
          <div>
            <div className="text-muted-foreground mb-1 text-xs">Credit notes</div>
            <div className="flex flex-wrap gap-2">
              {credits.map((c) => (
                <EntityRef
                  key={c.id}
                  type={c.type}
                  id={c.id}
                  label={c.label}
                  tab={c.tab}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ) : null}
        {receipts.length > 0 ? (
          <div>
            <div className="text-muted-foreground mb-1 text-xs">Receipts</div>
            <div className="flex flex-wrap gap-2">
              {receipts.map((r) => (
                <EntityRef
                  key={r.id}
                  type={r.type}
                  id={r.id}
                  label={r.label}
                  tab={r.tab}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Pure integer math — same approach as ReferenceRatePill, avoids `toFixed`. */
function bpsToPct(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const remainder = Math.abs(bps % 100);
  if (remainder === 0) return `${whole}%`;
  const padded = remainder.toString().padStart(2, '0');
  const fractional = padded.endsWith('0') ? padded.slice(0, 1) : padded;
  return `${whole}.${fractional}%`;
}
