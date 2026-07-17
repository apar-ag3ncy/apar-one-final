'use client';

import { useEffect, useState } from 'react';
import { BanknoteIcon, PlusIcon, WalletIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { DateField } from '@/components/shared/date-field';
import { StatusBadge } from '@/components/shared/status-badge';
import { formatINR } from '@/components/shared/format-inr';
import { paiseToRupees, rupeesToPaise } from '@/lib/money';
import {
  listAgencyBankAccounts,
  type AgencyBankAccountRow,
} from '@/lib/server/billing/agency-banks';
import { listBankAccounts, type BankAccountRow } from '@/lib/server/entities/bank-accounts';
import { useEntityMutation } from '@/components/os/auth/entity-mutation-gate';
import {
  amendVendorPayment,
  getVendorPayablesByProject,
  getVendorPaymentAmendmentChain,
  listOpenBillsForVendor,
  listVendorPayments,
  recordVendorPayment,
  recordVendorPaymentsBulk,
  reverseVendorPayment,
  type OpenBillRow,
  type PayableByProjectRow,
  type VendorPaymentRow,
} from '@/lib/server/billing/vendor-payments';
import type { TransactionAmendmentChainEntry } from '@/lib/server/billing/transaction-amendment-chain';

type DueState = { rows: readonly PayableByProjectRow[]; totalPaise: bigint };

/**
 * Vendor "Transactions" tab — records money PAID to the vendor (our bank or
 * cash ↔ the vendor's bank), with TDS/GST, against the vendor's open
 * `vendor_bill` transactions. Posts vendor_payment_made and shows a
 * project-grouped "Due to pay" summary.
 */
export function VendorPaymentsSection({
  vendorId,
  vendorName,
}: {
  vendorId: string;
  vendorName: string;
}) {
  const [payments, setPayments] = useState<readonly VendorPaymentRow[] | null>(null);
  const [due, setDue] = useState<DueState | null>(null);
  const [bills, setBills] = useState<readonly OpenBillRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [reversing, setReversing] = useState<{ id: string; amount: bigint } | null>(null);
  const [amending, setAmending] = useState<VendorPaymentRow | null>(null);
  const [historyTarget, setHistoryTarget] = useState<VendorPaymentRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  // OS read-only bridge — permissive outside the OS. Recording a payment is an
  // edit; reversing a posted payment is destructive (delete grant).
  const { canEdit, canDelete } = useEntityMutation();
  // Amend & reissue reverses the original + records a fresh one, so it needs both.
  const canAmend = canEdit && canDelete;

  async function reload() {
    try {
      const [p, d, b] = await Promise.all([
        listVendorPayments(vendorId),
        getVendorPayablesByProject(vendorId),
        listOpenBillsForVendor(vendorId),
      ]);
      setPayments(p);
      setDue(d);
      setBills(b);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load transactions');
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listVendorPayments(vendorId),
      getVendorPayablesByProject(vendorId),
      listOpenBillsForVendor(vendorId),
    ])
      .then(([p, d, b]) => {
        if (cancelled) return;
        setPayments(p);
        setDue(d);
        setBills(b);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load transactions');
      });
    return () => {
      cancelled = true;
    };
  }, [vendorId]);

  if (error) {
    return <EmptyState icon={WalletIcon} title="Could not load transactions" description={error} />;
  }
  if (payments === null || due === null || bills === null) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <DueToPayCard due={due} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Money paid{' '}
            <span className="text-muted-foreground text-xs font-normal">({payments.length})</span>
          </CardTitle>
          {canEdit ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>
                Bulk record
              </Button>
              <Button size="sm" onClick={() => setFormOpen(true)}>
                <PlusIcon className="mr-1.5 size-4" aria-hidden />
                Record payment
              </Button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {payments.length === 0 ? (
            <EmptyState
              icon={BanknoteIcon}
              title="No money recorded yet"
              description={`Record money paid to ${vendorName} — pick the bank accounts (or cash), the amount, any TDS/GST, and the bills it settles.`}
            />
          ) : (
            <ul className="divide-y">
              {payments.map((p) => (
                <li key={p.transactionId} className="flex flex-col gap-1.5 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">Payment</span>
                        <StatusBadge
                          tone={p.status === 'posted' ? 'success' : 'neutral'}
                          label={p.status}
                          dot={false}
                        />
                        {p.amendedFromTransactionId ? (
                          <button
                            type="button"
                            onClick={() => setHistoryTarget(p)}
                            title="Reissue of an amended payment — click for the amendment history"
                            aria-label="View amendment history"
                          >
                            <StatusBadge tone="info" label="Reissue" dot={false} />
                          </button>
                        ) : null}
                      </div>
                      {p.allocations.length > 0 ? (
                        <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
                          {p.allocations.map((a) => (
                            <li key={a.billId} className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono">{a.billDocumentNumber}</span>
                              <span>·</span>
                              <span>{a.projectName ?? 'No project'}</span>
                              <span>·</span>
                              <span className="tabular-nums">{formatINR(a.allocatedPaise)}</span>
                              {a.remainingOnBillPaise > 0n ? (
                                <span className="tabular-nums">
                                  ({formatINR(a.remainingOnBillPaise)} left)
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-muted-foreground text-xs italic">Unallocated</span>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <div className="font-mono text-sm tabular-nums">
                        {formatINR(p.amountPaise)}
                      </div>
                      <div className="text-muted-foreground text-xs">{formatDate(p.txnDate)}</div>
                      <div className="flex items-center gap-1.5">
                        {p.status === 'posted' && canAmend ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => setAmending(p)}
                            title="Reverse this payment and reissue a corrected one"
                          >
                            Amend
                          </Button>
                        ) : null}
                        {p.status === 'posted' && canDelete ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() =>
                              setReversing({ id: p.transactionId, amount: p.amountPaise })
                            }
                          >
                            Reverse
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <BillDuesCard bills={bills} />

      <RecordVendorPaymentDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        vendorId={vendorId}
        vendorName={vendorName}
        onRecorded={() => {
          setFormOpen(false);
          void reload();
        }}
      />

      <ReversePaymentDialog
        target={reversing}
        onOpenChange={(o) => !o && setReversing(null)}
        onReversed={() => {
          setReversing(null);
          void reload();
        }}
      />

      <RecordVendorPaymentDialog
        open={amending !== null}
        onOpenChange={(o) => !o && setAmending(null)}
        vendorId={vendorId}
        vendorName={vendorName}
        amendOf={
          amending ? { id: amending.transactionId, amountPaise: amending.amountPaise } : null
        }
        onRecorded={() => {
          setAmending(null);
          void reload();
        }}
      />

      <PaymentHistoryDialog
        target={historyTarget}
        onOpenChange={(o) => !o && setHistoryTarget(null)}
      />

      <BulkRecordPaymentsModal
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        vendorId={vendorId}
        vendorName={vendorName}
        onRecorded={() => {
          setBulkOpen(false);
          void reload();
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Amendment history dialog (§7.2)                                             */
/* -------------------------------------------------------------------------- */

function PaymentHistoryDialog({
  target,
  onOpenChange,
}: {
  target: VendorPaymentRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [chain, setChain] = useState<readonly TransactionAmendmentChainEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setChain(null);
      setError(null);
    });
    getVendorPaymentAmendmentChain(target.transactionId)
      .then((c) => !cancelled && setChain(c))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Failed'));
    return () => {
      cancelled = true;
    };
  }, [target]);

  if (!target) return null;

  return (
    <div
      className="os-modal-overlay"
      style={modalOverlayStyle}
      onMouseDown={() => onOpenChange(false)}
    >
      <div
        className="os-modal"
        style={{ ...modalBoxStyle, width: 480 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="os-modal-head" style={modalHeadStyle}>
          <div className="font-display" style={{ fontSize: 18 }}>
            Amendment history
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div style={{ padding: 18 }}>
          {error ? (
            <p style={{ fontSize: 13, color: 'var(--text-error, #c33)' }}>{error}</p>
          ) : chain === null ? (
            <Skeleton className="h-24 w-full" />
          ) : chain.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No amendment history.</p>
          ) : (
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 360,
                overflowY: 'auto',
              }}
            >
              {chain.map((e, i) => (
                <li
                  key={e.transactionId}
                  style={{
                    border: '1px solid var(--border, #e5e7eb)',
                    borderRadius: 8,
                    padding: '8px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <StatusBadge
                        tone={i === 0 ? 'neutral' : e.isCurrent ? 'success' : 'warning'}
                        label={i === 0 ? 'Original' : e.isCurrent ? 'Current' : 'Reversed'}
                        dot={false}
                      />
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {formatDate(e.txnDate)}
                      </span>
                    </div>
                    <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                      {formatINR(BigInt(e.amountPaise))}
                    </span>
                  </div>
                  {e.reason ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      <strong>Reason:</strong> {e.reason}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '12px 18px 14px',
            borderTop: '1px solid var(--border, #e5e7eb)',
          }}
        >
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Bulk record payments (§7.3)                                                 */
/* -------------------------------------------------------------------------- */

type BulkVendorRow = { date: string; amount: string; tds: string; mode: 'bank' | 'cash' };

function BulkRecordPaymentsModal({
  open,
  onOpenChange,
  vendorId,
  vendorName,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId: string;
  vendorName: string;
  onRecorded: () => void;
}) {
  const [banks, setBanks] = useState<readonly AgencyBankAccountRow[]>([]);
  const [bankAccountId, setBankAccountId] = useState('');
  const [rows, setRows] = useState<BulkVendorRow[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setRows([{ date: todayISO(), amount: '', tds: '', mode: 'bank' }]);
    });
    listAgencyBankAccounts()
      .then((b) => {
        if (cancelled) return;
        setBanks(b);
        if (b[0]) setBankAccountId(b[0].id);
      })
      .catch(() => !cancelled && setBanks([]));
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  function updateRow(i: number, patch: Partial<BulkVendorRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function submit() {
    const parsed: {
      paymentDate: string;
      totalPaise: bigint;
      tdsPaise: bigint;
      mode: 'bank' | 'cash';
    }[] = [];
    try {
      for (const r of rows) {
        const total = parsePaise(r.amount);
        if (total <= 0n) continue;
        parsed.push({
          paymentDate: r.date,
          totalPaise: total,
          tdsPaise: parsePaise(r.tds),
          mode: r.mode,
        });
      }
    } catch {
      toast.error('Enter valid amounts.');
      return;
    }
    if (parsed.length === 0) {
      toast.error('Add at least one row with an amount.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await recordVendorPaymentsBulk({ vendorId, bankAccountId, rows: parsed });
      if (res.failed === 0) {
        toast.success(`Recorded ${res.recorded} payment${res.recorded === 1 ? '' : 's'}.`);
      } else {
        toast.warning(
          `Recorded ${res.recorded}; ${res.failed} failed (row ${res.errors[0]?.row}: ${res.errors[0]?.message}).`,
        );
      }
      onRecorded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Bulk record failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="os-modal-overlay"
      style={modalOverlayStyle}
      onMouseDown={() => !submitting && onOpenChange(false)}
    >
      <div className="os-modal" style={modalBoxStyle} onMouseDown={(e) => e.stopPropagation()}>
        <div className="os-modal-head" style={modalHeadStyle}>
          <div className="font-display" style={{ fontSize: 18 }}>
            Bulk record payments — {vendorName}
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
            gap: 12,
            overflowY: 'auto',
          }}
        >
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
            Each row posts a payment and auto-applies it FIFO to the vendor&apos;s oldest open
            bills. Up to 50 rows.
          </p>
          <div className="os-field">
            <span className="os-field-label">From our bank account (for bank rows)</span>
            <select
              value={bankAccountId}
              onChange={(e) => setBankAccountId(e.target.value)}
              disabled={submitting}
              style={osInputStyle}
            >
              <option value="">Pick a bank</option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label} ••{b.accountLast4}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '150px 1fr 1fr 110px 32px',
                gap: 8,
                fontSize: 11,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              <span>Date</span>
              <span>Amount ₹</span>
              <span>TDS ₹</span>
              <span>Mode</span>
              <span />
            </div>
            {rows.map((r, i) => (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '150px 1fr 1fr 110px 32px',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <DateField
                  value={r.date}
                  onChange={(next) => updateRow(i, { date: next })}
                  disabled={submitting}
                  clearable={false}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={r.amount}
                  onChange={(e) => updateRow(i, { amount: e.target.value })}
                  disabled={submitting}
                  style={osInputStyle}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={r.tds}
                  onChange={(e) => updateRow(i, { tds: e.target.value })}
                  disabled={submitting}
                  style={osInputStyle}
                />
                <select
                  value={r.mode}
                  onChange={(e) => updateRow(i, { mode: e.target.value as 'bank' | 'cash' })}
                  disabled={submitting}
                  style={osInputStyle}
                >
                  <option value="bank">Bank</option>
                  <option value="cash">Cash</option>
                </select>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                  disabled={submitting || rows.length === 1}
                  aria-label="Remove row"
                  style={{ padding: '4px 8px' }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn"
            style={{ alignSelf: 'flex-start' }}
            onClick={() =>
              setRows((prev) =>
                prev.length >= 50
                  ? prev
                  : [...prev, { date: todayISO(), amount: '', tds: '', mode: 'bank' }],
              )
            }
            disabled={submitting || rows.length >= 50}
          >
            <PlusIcon className="mr-1 size-3.5" aria-hidden /> Add row
          </button>
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
          <Button size="sm" onClick={submit} disabled={submitting}>
            {submitting ? 'Recording…' : 'Record all'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DueToPayCard({ due }: { due: DueState }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Due to pay</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tabular-nums">{formatINR(due.totalPaise)}</div>
        <p className="text-muted-foreground mt-1 text-xs">
          Outstanding across this vendor&apos;s recorded bills, by project.
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

/** Per-bill remaining dues — each open bill with how much is still due
 * (recorded payable minus what's been paid/adjusted). */
function BillDuesCard({ bills }: { bills: readonly OpenBillRow[] }) {
  const totalDue = bills.reduce((acc, b) => acc + b.outstandingPaise, 0n);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">
          Bill dues{' '}
          <span className="text-muted-foreground text-xs font-normal">({bills.length})</span>
        </CardTitle>
        {bills.length > 0 ? (
          <span className="font-mono text-sm tabular-nums">{formatINR(totalDue)} due</span>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {bills.length === 0 ? (
          <p className="text-muted-foreground px-6 pb-4 text-sm italic">
            No open bills — everything is cleared.
          </p>
        ) : (
          <ul className="divide-y">
            {bills.map((bill) => {
              const paidPaise = bill.totalPaise - bill.outstandingPaise;
              const partiallyPaid = paidPaise > 0n;
              return (
                <li key={bill.billId} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm">{bill.documentNumber}</span>
                      <StatusBadge
                        tone={partiallyPaid ? 'info' : 'warning'}
                        label={partiallyPaid ? 'partially paid' : 'unpaid'}
                        dot={false}
                      />
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {bill.projectName ?? 'No project'} · {formatDate(bill.documentDate)}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <div className="font-mono text-sm tabular-nums">
                      {formatINR(bill.outstandingPaise)}{' '}
                      <span className="text-muted-foreground text-xs">due</span>
                    </div>
                    <div className="text-muted-foreground text-xs tabular-nums">
                      of {formatINR(bill.totalPaise)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Record vendor payment dialog                                                */
/* -------------------------------------------------------------------------- */

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function normaliseRupee(s: string): string {
  return s.replace(/[,\s]/g, '').trim();
}

function parsePaise(s: string): bigint {
  const t = normaliseRupee(s);
  if (!t) return 0n;
  return rupeesToPaise(t);
}

function RecordVendorPaymentDialog({
  open,
  onOpenChange,
  vendorId,
  vendorName,
  onRecorded,
  amendOf = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId: string;
  vendorName: string;
  onRecorded: () => void;
  /** When set, this is an "Amend & reissue" of a posted payment (§7.2). */
  amendOf?: { id: string; amountPaise: bigint } | null;
}) {
  const [ourBanks, setOurBanks] = useState<readonly AgencyBankAccountRow[]>([]);
  const [vendorBanks, setVendorBanks] = useState<readonly BankAccountRow[]>([]);
  const [bills, setBills] = useState<readonly OpenBillRow[]>([]);
  const [mode, setMode] = useState<'bank' | 'cash'>('bank');
  // NEFT / RTGS / IMPS / UPI / cheque — how the money went out (bank mode only).
  const [transferMethod, setTransferMethod] = useState<
    'neft' | 'rtgs' | 'imps' | 'upi' | 'cheque' | ''
  >('');
  // Cheque capture (0064) — surfaced only while transferMethod === 'cheque'.
  const [chequeNumber, setChequeNumber] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [counterpartyBankAccountId, setCounterpartyBankAccountId] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [amountRupees, setAmountRupees] = useState('');
  const [tdsRupees, setTdsRupees] = useState('');
  const [tdsSection, setTdsSection] = useState('');
  const [gstRupees, setGstRupees] = useState('');
  const [allocs, setAllocs] = useState<Record<string, string>>({});
  // Amend reason (§7.2) — only used when amendOf is set.
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setMode('bank');
      setTransferMethod('');
      setChequeNumber('');
      setChequeDate('');
      setBankAccountId('');
      setCounterpartyBankAccountId('');
      setPaymentDate(todayISO());
      setAmountRupees(amendOf ? paiseToRupees(amendOf.amountPaise) : '');
      setTdsRupees('');
      setTdsSection('');
      setGstRupees('');
      setAllocs({});
      setReason('');
    });
    listAgencyBankAccounts()
      .then((b) => {
        if (cancelled) return;
        setOurBanks(b);
        if (b[0]) setBankAccountId(b[0].id);
      })
      .catch(() => !cancelled && setOurBanks([]));
    listBankAccounts({ entityType: 'vendor', entityId: vendorId })
      .then((b) => !cancelled && setVendorBanks(b))
      .catch(() => !cancelled && setVendorBanks([]));
    listOpenBillsForVendor(vendorId)
      .then((bl) => !cancelled && setBills(bl))
      .catch(() => !cancelled && setBills([]));
    return () => {
      cancelled = true;
    };
    // Open-transition guard: seed once when the dialog opens; amendOf is stable
    // for the lifetime of an open amend and must NOT retrigger the reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vendorId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onOpenChange]);

  if (!open) return null;

  let netHint: bigint | null = null;
  try {
    netHint = parsePaise(amountRupees) - parsePaise(tdsRupees);
  } catch {
    netHint = null;
  }

  async function submit() {
    if (mode === 'bank' && !bankAccountId) {
      toast.error('Pick the bank account the money was paid from.');
      return;
    }
    let totalPaise: bigint;
    let tdsPaise: bigint;
    let gstPaise: bigint;
    try {
      totalPaise = parsePaise(amountRupees);
      tdsPaise = parsePaise(tdsRupees);
      gstPaise = parsePaise(gstRupees);
    } catch {
      toast.error('Enter valid amounts.');
      return;
    }
    if (totalPaise <= 0n) {
      toast.error('Amount must be positive.');
      return;
    }

    let allocations: Array<{ billTxnId: string; amountPaise: bigint }> = [];
    try {
      allocations = Object.entries(allocs)
        .filter(([, val]) => val.trim())
        .map(([billTxnId, val]) => {
          const paise = parsePaise(val);
          if (paise <= 0n) throw new Error('Allocation amounts must be positive.');
          return { billTxnId, amountPaise: paise };
        });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Invalid allocation amount.');
      return;
    }
    if (allocations.reduce((a, x) => a + x.amountPaise, 0n) > totalPaise) {
      toast.error('Allocations exceed the amount paid.');
      return;
    }

    if (mode === 'bank' && transferMethod === 'cheque' && !chequeNumber.trim()) {
      toast.error('Enter the cheque number.');
      return;
    }

    if (amendOf && reason.trim().length < 10) {
      toast.error('Enter an amendment reason of at least 10 characters.');
      return;
    }

    const paymentInput = {
      vendorId,
      mode,
      transferMethod: mode === 'bank' && transferMethod ? transferMethod : null,
      chequeNumber:
        mode === 'bank' && transferMethod === 'cheque' ? chequeNumber.trim() || null : null,
      chequeDate: mode === 'bank' && transferMethod === 'cheque' ? chequeDate || null : null,
      bankAccountId: mode === 'bank' ? bankAccountId : null,
      counterpartyBankAccountId:
        mode === 'bank' && counterpartyBankAccountId ? counterpartyBankAccountId : null,
      paymentDate,
      totalPaise,
      tdsPaise,
      tdsSection: tdsSection.trim() || null,
      gstPaise,
      allocations,
    };

    setSubmitting(true);
    try {
      const result = amendOf
        ? await amendVendorPayment(amendOf.id, paymentInput, reason.trim())
        : await recordVendorPayment(paymentInput);
      toast.success(
        amendOf
          ? `Amended — payment ${result.voucherNumber} reissued.`
          : `Payment posted (${result.voucherNumber}) — ${formatINR(result.allocatedPaise)} applied.`,
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
            {amendOf ? 'Amend & reissue payment' : 'Record money paid'} — {vendorName}
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
          {amendOf ? (
            <div className="os-field">
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px' }}>
                Reverses the original payment and posts a corrected one, linked as an amendment.
                Give a reason (≥10 characters).
              </p>
              <span className="os-field-label">Amendment reason</span>
              <textarea
                rows={2}
                placeholder="e.g. Wrong amount recorded — corrected per bank statement"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={submitting}
                style={{ ...osInputStyle, resize: 'vertical', minHeight: 48 }}
              />
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 8 }}>
            {(['bank', 'cash'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                disabled={submitting}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  borderRadius: 7,
                  fontSize: 13,
                  cursor: 'pointer',
                  border: `1px solid ${mode === m ? 'var(--apar-red, #E63A1F)' : 'var(--border, #e5e7eb)'}`,
                  background: mode === m ? 'rgba(230,58,31,0.08)' : 'transparent',
                  color: 'inherit',
                }}
              >
                {m === 'bank' ? 'Bank transfer' : 'Cash'}
              </button>
            ))}
          </div>

          {mode === 'bank' ? (
            <div className="os-field">
              <span className="os-field-label">Transfer method</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['neft', 'rtgs', 'imps', 'upi', 'cheque'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTransferMethod((cur) => (cur === t ? '' : t))}
                    disabled={submitting}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 999,
                      fontSize: 12,
                      cursor: 'pointer',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      border: `1px solid ${transferMethod === t ? 'var(--apar-red, #E63A1F)' : 'var(--border, #e5e7eb)'}`,
                      background: transferMethod === t ? 'rgba(230,58,31,0.08)' : 'transparent',
                      color: 'inherit',
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {mode === 'bank' && transferMethod === 'cheque' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="os-field">
                <span className="os-field-label">Cheque number</span>
                <input
                  value={chequeNumber}
                  onChange={(e) => setChequeNumber(e.target.value)}
                  disabled={submitting}
                  placeholder="e.g. 123456"
                  style={osInputStyle}
                />
              </div>
              <div className="os-field">
                <span className="os-field-label">Cheque date (optional)</span>
                <DateField
                  value={chequeDate}
                  onChange={(next) => setChequeDate(next)}
                  disabled={submitting}
                />
              </div>
            </div>
          ) : null}

          {mode === 'bank' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="os-field">
                <span className="os-field-label">From our bank account</span>
                <select
                  value={bankAccountId}
                  onChange={(e) => setBankAccountId(e.target.value)}
                  disabled={submitting}
                  style={osInputStyle}
                >
                  <option value="">
                    {ourBanks.length === 0
                      ? 'No bank accounts — add one in Settings'
                      : 'Pick a bank'}
                  </option>
                  {ourBanks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label} ••{b.accountLast4}
                      {b.isActive ? '' : ' (inactive)'}
                    </option>
                  ))}
                </select>
              </div>
              <div className="os-field">
                <span className="os-field-label">To vendor&apos;s bank (optional)</span>
                <select
                  value={counterpartyBankAccountId}
                  onChange={(e) => setCounterpartyBankAccountId(e.target.value)}
                  disabled={submitting}
                  style={osInputStyle}
                >
                  <option value="">
                    {vendorBanks.length === 0 ? 'No vendor bank on file' : '— Not specified —'}
                  </option>
                  {vendorBanks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bankName} ••{b.accountLast4}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
              Cash payment — posts from Cash on Hand (1110).
            </p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div className="os-field">
              <label htmlFor="vp-date" className="os-field-label">
                Date
              </label>
              <DateField
                id="vp-date"
                value={paymentDate}
                onChange={(next) => setPaymentDate(next)}
                disabled={submitting}
                clearable={false}
              />
            </div>
            <div className="os-field">
              <label htmlFor="vp-amt" className="os-field-label">
                Amount ₹ (gross)
              </label>
              <input
                id="vp-amt"
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
              <label htmlFor="vp-gst" className="os-field-label">
                GST ₹ (incl., noted)
              </label>
              <input
                id="vp-gst"
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="os-field">
              <label htmlFor="vp-tds" className="os-field-label">
                TDS we withheld ₹
              </label>
              <input
                id="vp-tds"
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
              <label htmlFor="vp-tds-sec" className="os-field-label">
                TDS section (optional)
              </label>
              <input
                id="vp-tds-sec"
                type="text"
                placeholder="e.g. 194C"
                value={tdsSection}
                onChange={(e) => setTdsSection(e.target.value)}
                disabled={submitting}
                style={osInputStyle}
              />
            </div>
          </div>

          {netHint !== null && netHint >= 0n && parsePaise(tdsRupees) > 0n ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
              Net cash paid: <strong>{formatINR(netHint)}</strong> (amount − TDS). The full gross
              clears the bill; TDS posts to TDS Payable.
            </p>
          ) : null}

          <div className="os-field">
            <span className="os-field-label">
              Allocate to bills{' '}
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                (blank = auto oldest-first)
              </span>
            </span>
            {bills.length === 0 ? (
              <p className="os-field-hint">
                No open bills for this vendor — create one in the Bills tab to link it.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {bills.map((b) => (
                  <div
                    key={b.billTxnId}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 130px',
                      gap: 8,
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontFamily: 'var(--font-mono, monospace)' }}>
                        {b.documentNumber}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {b.projectName ?? 'No project'} · due {formatINR(b.outstandingPaise)}
                      </div>
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="₹ applied"
                      value={allocs[b.billTxnId] ?? ''}
                      onChange={(e) =>
                        setAllocs((prev) => ({ ...prev, [b.billTxnId]: e.target.value }))
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
          <Button
            size="sm"
            onClick={submit}
            disabled={submitting || (mode === 'bank' && !bankAccountId)}
          >
            {submitting
              ? amendOf
                ? 'Reissuing…'
                : 'Recording…'
              : amendOf
                ? 'Reverse & reissue'
                : 'Record & post'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Reverse payment dialog                                                      */
/* -------------------------------------------------------------------------- */

function ReversePaymentDialog({
  target,
  onOpenChange,
  onReversed,
}: {
  target: { id: string; amount: bigint } | null;
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
      await reverseVendorPayment(target!.id, r);
      toast.success('Payment reversed.');
      onReversed();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not reverse the payment.');
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
            Reverse payment ({formatINR(target.amount)})
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
            Posts an offsetting entry and marks this payment reversed (the ledger is append-only —
            nothing is deleted). Give a reason (≥10 characters).
          </p>
          <textarea
            rows={3}
            placeholder="e.g. Duplicate / mis-recorded payment"
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
            {submitting ? 'Reversing…' : 'Reverse payment'}
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

// (app) route doesn't load the OS shell's os.css; style the modal chrome inline.
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
