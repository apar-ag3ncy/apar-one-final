'use client';

import { useEffect, useState } from 'react';
import { PlusIcon, ReceiptIcon, WalletIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusBadge } from '@/components/shared/status-badge';
import { formatINR } from '@/components/shared/format-inr';
import { rupeesToPaise } from '@/lib/money';
import {
  listAgencyBankAccounts,
  type AgencyBankAccountRow,
} from '@/lib/server/billing/agency-banks';
import {
  getClientReceivablesByProject,
  listClientReceipts,
  listOpenInvoicesForClient,
  recordManualReceipt,
  reverseClientReceipt,
  type ClientReceiptRow,
  type OpenInvoiceRow,
  type ReceivableByProjectRow,
} from '@/lib/server/billing/receipts';
import { listBankAccounts, type BankAccountRow } from '@/lib/server/entities/bank-accounts';

const STATUS_TONE: Record<string, 'neutral' | 'success' | 'danger'> = {
  posted: 'success',
  unposted: 'neutral',
  reversed: 'danger',
};

const METHOD_LABEL: Record<string, string> = {
  bank_transfer: 'Bank transfer',
  upi: 'UPI',
  cheque: 'Cheque',
  card: 'Card',
  cash: 'Cash',
};

type DueState = { rows: readonly ReceivableByProjectRow[]; totalPaise: bigint };

/**
 * Client "Payments" tab. Records money RECEIVED from the client against open
 * invoices (posts a `client_payment_received` ledger txn via recordManualReceipt)
 * and shows a project-grouped "Due to collect" summary above the receipts list.
 */
export function ClientPaymentsSection({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const [receipts, setReceipts] = useState<readonly ClientReceiptRow[] | null>(null);
  const [due, setDue] = useState<DueState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [reversing, setReversing] = useState<{ id: string; ref: string; amount: bigint } | null>(
    null,
  );

  async function reload() {
    try {
      const [r, d] = await Promise.all([
        listClientReceipts(clientId),
        getClientReceivablesByProject(clientId),
      ]);
      setReceipts(r);
      setDue(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load payments');
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([listClientReceipts(clientId), getClientReceivablesByProject(clientId)])
      .then(([r, d]) => {
        if (cancelled) return;
        setReceipts(r);
        setDue(d);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load payments');
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (error) {
    return <EmptyState icon={WalletIcon} title="Could not load payments" description={error} />;
  }
  if (receipts === null || due === null) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <DueToCollectCard due={due} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Payments received{' '}
            <span className="text-muted-foreground text-xs font-normal">({receipts.length})</span>
          </CardTitle>
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" aria-hidden />
            Record payment
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {receipts.length === 0 ? (
            <EmptyState
              icon={ReceiptIcon}
              title="No payments recorded yet"
              description={`Record a payment received from ${clientName}, allocate it to the open invoices it settles, and it posts straight to the ledger.`}
            />
          ) : (
            <ul className="divide-y">
              {receipts.map((r) => (
                <li
                  key={r.id}
                  className={`flex flex-col gap-1.5 px-4 py-3 ${
                    r.status === 'reversed' ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground font-mono text-xs">
                          {r.receiptNumber}
                        </span>
                        <StatusBadge
                          tone={STATUS_TONE[r.status] ?? 'neutral'}
                          label={r.status}
                          dot={false}
                        />
                        <span className="text-muted-foreground text-xs">
                          {METHOD_LABEL[r.method] ?? r.method}
                        </span>
                        {r.counterpartyBankLabel ? (
                          <span className="text-muted-foreground text-xs">
                            from {r.counterpartyBankLabel}
                          </span>
                        ) : null}
                      </div>
                      {r.allocations.length > 0 ? (
                        <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
                          {r.allocations.map((a) => (
                            <li key={a.invoiceId} className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono">{a.invoiceDocumentNumber}</span>
                              <span>·</span>
                              <span>{a.projectName ?? 'No project'}</span>
                              <span>·</span>
                              <span className="tabular-nums">{formatINR(a.allocatedPaise)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-muted-foreground text-xs italic">Unallocated</span>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <div className="font-mono text-sm tabular-nums">
                        {formatINR(r.totalPaise)}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {formatDate(r.receiptDate)}
                      </div>
                      {r.tdsPaise > 0n ? (
                        <div className="text-muted-foreground text-xs">
                          TDS {formatINR(r.tdsPaise)}
                        </div>
                      ) : null}
                      {r.gstPaise > 0n ? (
                        <div className="text-muted-foreground text-xs">
                          GST {formatINR(r.gstPaise)}
                        </div>
                      ) : null}
                      {r.status === 'posted' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-0.5 h-7 px-2"
                          onClick={() =>
                            setReversing({
                              id: r.id,
                              ref: r.receiptNumber,
                              amount: r.totalPaise,
                            })
                          }
                        >
                          Reverse
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <RecordReceiptDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        clientId={clientId}
        clientName={clientName}
        onRecorded={() => {
          setFormOpen(false);
          void reload();
        }}
      />

      <ReverseReceiptDialog
        target={reversing}
        onOpenChange={(o) => !o && setReversing(null)}
        onReversed={() => {
          setReversing(null);
          void reload();
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Reverse receipt dialog                                                      */
/* -------------------------------------------------------------------------- */

function ReverseReceiptDialog({
  target,
  onOpenChange,
  onReversed,
}: {
  target: { id: string; ref: string; amount: bigint } | null;
  onOpenChange: (open: boolean) => void;
  onReversed: () => void;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (target) queueMicrotask(() => setReason(''));
  }, [target]);

  if (!target) return null;

  async function submit() {
    const r = reason.trim();
    if (r.length < 10) {
      toast.error('Enter a reason of at least 10 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await reverseClientReceipt(target!.id, r);
      toast.success(`Receipt ${target!.ref} reversed.`);
      onReversed();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not reverse the receipt.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="os-modal-overlay"
      style={modalOverlayStyle}
      onMouseDown={() => {
        if (!submitting) onOpenChange(false);
      }}
    >
      <div
        className="os-modal"
        style={{ ...modalBoxStyle, width: 460 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="os-modal-head" style={modalHeadStyle}>
          <div className="font-display" style={{ fontSize: 18 }}>
            Reverse receipt ({formatINR(target.amount)})
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            Posts an offsetting entry (the ledger is append-only — nothing is deleted), un-applies
            this receipt from its invoices, and re-opens the receivable. Give a reason (≥10
            characters).
          </p>
          <textarea
            rows={3}
            placeholder="e.g. Duplicate / mis-recorded receipt"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
            style={{ ...osInputStyle, resize: 'vertical', minHeight: 64 }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            padding: '12px 18px 14px',
            borderTop: '1px solid var(--border, #e5e7eb)',
          }}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={submit} disabled={submitting}>
            {submitting ? 'Reversing…' : 'Reverse receipt'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DueToCollectCard({ due }: { due: DueState }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Due to collect</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tabular-nums">{formatINR(due.totalPaise)}</div>
        <p className="text-muted-foreground mt-1 text-xs">
          Outstanding across this client&apos;s open invoices, by project.
        </p>
        {due.rows.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2">
            {due.rows.map((row) => (
              <li
                key={row.projectId ?? 'none'}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span>{row.projectName ?? 'Unassigned'}</span>
                <span className="font-mono tabular-nums">{formatINR(row.outstandingPaise)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground mt-3 text-sm italic">Nothing outstanding.</p>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Record receipt dialog                                                       */
/* -------------------------------------------------------------------------- */

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function normaliseRupee(s: string): string {
  return s.replace(/[,\s]/g, '').trim();
}

/** Parse an optional rupee input to paise; '' → 0n. Throws on garbage. */
function parseOptionalRupees(s: string): bigint {
  const t = normaliseRupee(s);
  if (!t) return 0n;
  return rupeesToPaise(t);
}

// Sentinel value in the "received into" select meaning a cash receipt (no bank).
const CASH_SENTINEL = '__cash__';

const RECEIPT_METHODS: Array<{
  value: 'bank_transfer' | 'upi' | 'cheque' | 'card';
  label: string;
}> = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' },
];

function RecordReceiptDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  onRecorded: () => void;
}) {
  const [banks, setBanks] = useState<readonly AgencyBankAccountRow[]>([]);
  const [clientBanks, setClientBanks] = useState<readonly BankAccountRow[]>([]);
  const [invoices, setInvoices] = useState<readonly OpenInvoiceRow[]>([]);
  // '' = unset, CASH_SENTINEL = cash (no bank), else an agency bank account id.
  const [bankAccountId, setBankAccountId] = useState('');
  const [counterpartyBankId, setCounterpartyBankId] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [amountRupees, setAmountRupees] = useState('');
  const [method, setMethod] = useState<'bank_transfer' | 'upi' | 'cheque' | 'card'>(
    'bank_transfer',
  );
  const [tdsRupees, setTdsRupees] = useState('');
  const [gstRupees, setGstRupees] = useState('');
  // Per-invoice manual allocation amounts (rupee strings keyed by invoiceId).
  const [allocs, setAllocs] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const isCash = bankAccountId === CASH_SENTINEL;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setBankAccountId('');
      setCounterpartyBankId('');
      setPaymentDate(todayISO());
      setAmountRupees('');
      setMethod('bank_transfer');
      setTdsRupees('');
      setGstRupees('');
      setAllocs({});
    });
    listAgencyBankAccounts()
      .then((b) => {
        if (cancelled) return;
        setBanks(b);
        // Pre-select the first (active-first) account.
        if (b[0]) setBankAccountId(b[0].id);
      })
      .catch(() => {
        if (!cancelled) setBanks([]);
      });
    listBankAccounts({ entityType: 'client', entityId: clientId })
      .then((b) => {
        if (cancelled) return;
        setClientBanks(b);
        // Default to the client's primary account (list is primary-first).
        if (b[0]) setCounterpartyBankId(b[0].id);
      })
      .catch(() => {
        if (!cancelled) setClientBanks([]);
      });
    listOpenInvoicesForClient(clientId)
      .then((inv) => {
        if (!cancelled) setInvoices(inv);
      })
      .catch(() => {
        if (!cancelled) setInvoices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, clientId]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onOpenChange]);

  if (!open) return null;

  const manualAllocCount = Object.values(allocs).filter((s) => s.trim()).length;

  // Live "settles" preview: cash + TDS = gross applied to invoices. Parse
  // leniently so a half-typed amount doesn't throw during render.
  const settlesHint = (() => {
    let cash = 0n;
    let tds = 0n;
    try {
      cash = parseOptionalRupees(amountRupees);
      tds = parseOptionalRupees(tdsRupees);
    } catch {
      return null;
    }
    if (tds <= 0n || cash <= 0n) return null;
    return `Settles ${formatINR(cash + tds)} against invoices (${formatINR(cash)} cash + ${formatINR(tds)} TDS).`;
  })();

  async function submit() {
    if (!bankAccountId) {
      toast.error('Pick where the money landed — a bank account or cash.');
      return;
    }
    let totalPaise: bigint; // net cash actually received
    let tdsPaise: bigint;
    let gstPaise: bigint;
    try {
      totalPaise = rupeesToPaise(normaliseRupee(amountRupees || '0'));
      tdsPaise = parseOptionalRupees(tdsRupees);
      gstPaise = parseOptionalRupees(gstRupees);
    } catch {
      toast.error('Enter valid amounts.');
      return;
    }
    if (totalPaise <= 0n) {
      toast.error('Amount received must be positive.');
      return;
    }

    // TDS the client withheld settles the invoice alongside the cash, so the
    // gross settled = cash received + TDS.
    const grossPaise = totalPaise + tdsPaise;

    // Build explicit allocations from any non-empty per-invoice inputs. If none
    // are filled, pass [] so the server FIFO-allocates oldest-first.
    let allocations: Array<{ invoiceId: string; allocatedPaise: bigint }> = [];
    try {
      allocations = Object.entries(allocs)
        .filter(([, val]) => val.trim())
        .map(([invoiceId, val]) => {
          const paise = rupeesToPaise(normaliseRupee(val));
          if (paise <= 0n) throw new Error('Allocation amounts must be positive.');
          return { invoiceId, allocatedPaise: paise };
        });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Invalid allocation amount.');
      return;
    }
    const allocSum = allocations.reduce((acc, a) => acc + a.allocatedPaise, 0n);
    if (allocSum > grossPaise) {
      toast.error('Allocations exceed the amount settled (cash + TDS).');
      return;
    }

    setSubmitting(true);
    try {
      const result = await recordManualReceipt({
        clientId,
        bankAccountId: isCash ? null : bankAccountId,
        counterpartyBankAccountId: isCash || !counterpartyBankId ? null : counterpartyBankId,
        receiptDate: paymentDate,
        totalPaise,
        method: isCash ? 'cash' : method,
        capturedTdsAmountPaise: tdsPaise,
        capturedGstAmountPaise: gstPaise,
        allocations,
      });
      toast.success(
        `Receipt ${result.receiptNumber} posted — ${formatINR(result.allocatedPaise)} applied.`,
      );
      onRecorded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record the payment.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="os-modal-overlay"
      style={modalOverlayStyle}
      onMouseDown={() => {
        if (!submitting) onOpenChange(false);
      }}
    >
      <div className="os-modal" style={modalBoxStyle} onMouseDown={(e) => e.stopPropagation()}>
        <div className="os-modal-head" style={modalHeadStyle}>
          <div className="font-display" style={{ fontSize: 18 }}>
            Record payment received — {clientName}
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            overflowY: 'auto',
          }}
        >
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            Posts a payment-received entry (Dr bank/cash + Dr TDS receivable / Cr receivables) and
            generates a receipt voucher. Allocate it to the open invoices it settles, or leave the
            amounts blank to auto-apply oldest-first. TDS the client withheld settles the invoice
            alongside the cash.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="os-field">
              <span className="os-field-label">Received into (our account)</span>
              <select
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                disabled={submitting}
                style={osInputStyle}
              >
                <option value="">
                  {banks.length === 0 ? 'No bank accounts found' : 'Pick a bank'}
                </option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label} ••{b.accountLast4}
                    {b.isActive ? '' : ' (inactive)'}
                  </option>
                ))}
                <option value={CASH_SENTINEL}>Cash (no bank account)</option>
              </select>
            </div>
            <div className="os-field">
              <span className="os-field-label">Client&apos;s bank account</span>
              <select
                value={isCash ? '' : counterpartyBankId}
                onChange={(e) => setCounterpartyBankId(e.target.value)}
                disabled={submitting || isCash}
                style={osInputStyle}
              >
                <option value="">
                  {isCash
                    ? 'n/a — cash'
                    : clientBanks.length === 0
                      ? 'None on file'
                      : 'Not specified'}
                </option>
                {clientBanks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.bankName} ••{b.accountLast4}
                    {b.isPrimary ? ' (primary)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="os-field">
              <label htmlFor="rcpt-date" className="os-field-label">
                Payment date
              </label>
              <input
                id="rcpt-date"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                disabled={submitting}
                style={osInputStyle}
              />
            </div>
            <div className="os-field">
              <span className="os-field-label">Method</span>
              <select
                value={isCash ? 'cash' : method}
                onChange={(e) => setMethod(e.target.value as typeof method)}
                disabled={submitting || isCash}
                style={osInputStyle}
              >
                {isCash ? <option value="cash">Cash</option> : null}
                {RECEIPT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div className="os-field">
              <label htmlFor="rcpt-amt" className="os-field-label">
                Amount received ₹
              </label>
              <input
                id="rcpt-amt"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                disabled={submitting}
                style={osInputStyle}
              />
            </div>
            <div className="os-field">
              <label htmlFor="rcpt-tds" className="os-field-label">
                TDS ₹ (optional)
              </label>
              <input
                id="rcpt-tds"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={tdsRupees}
                onChange={(e) => setTdsRupees(e.target.value)}
                disabled={submitting}
                style={osInputStyle}
              />
            </div>
            <div className="os-field">
              <label htmlFor="rcpt-gst" className="os-field-label">
                GST ₹ (optional)
              </label>
              <input
                id="rcpt-gst"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={gstRupees}
                onChange={(e) => setGstRupees(e.target.value)}
                disabled={submitting}
                style={osInputStyle}
              />
            </div>
          </div>

          {settlesHint ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{settlesHint}</p>
          ) : null}

          <div className="os-field">
            <span className="os-field-label">
              Allocate to invoices{' '}
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                ({manualAllocCount > 0 ? `${manualAllocCount} selected` : 'blank = auto FIFO'})
              </span>
            </span>
            {invoices.length === 0 ? (
              <p className="os-field-hint">No open invoices for this client.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {invoices.map((inv) => (
                  <div
                    key={inv.invoiceId}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 130px',
                      gap: 8,
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontFamily: 'var(--font-mono, monospace)' }}>
                        {inv.documentNumber}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {inv.projectName ?? 'No project'} · due {formatINR(inv.outstandingPaise)}
                      </div>
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="₹ applied"
                      value={allocs[inv.invoiceId] ?? ''}
                      onChange={(e) =>
                        setAllocs((prev) => ({ ...prev, [inv.invoiceId]: e.target.value }))
                      }
                      disabled={submitting}
                      style={osInputStyle}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            padding: '12px 18px 14px',
            borderTop: '1px solid var(--border, #e5e7eb)',
          }}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={submitting || !bankAccountId}>
            {submitting ? 'Recording…' : 'Record & post'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// These dialogs render in the (app) dashboard, which does not load the OS
// shell's os.css (`.os-root .os-modal*`). Style the modal chrome inline with
// globals/shadcn tokens (+ literal fallbacks) so it presents as a proper
// centered overlay regardless of route group.
const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 60,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  background: 'rgba(15, 23, 42, 0.45)',
};

const modalBoxStyle: React.CSSProperties = {
  width: 680,
  maxWidth: '95vw',
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  background: 'var(--popover, #ffffff)',
  color: 'var(--popover-foreground, #0f172a)',
  border: '1px solid var(--border, #e5e7eb)',
  borderRadius: 12,
  boxShadow: '0 24px 64px rgba(0, 0, 0, 0.32)',
};

const modalHeadStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '14px 18px',
  borderBottom: '1px solid var(--border, #e5e7eb)',
};

const osInputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--content, var(--background, #ffffff))',
  color: 'var(--text, var(--foreground, inherit))',
  border: '1px solid var(--border, #e5e7eb)',
  borderRadius: 7,
  padding: '8px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
};
