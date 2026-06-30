'use client';

import { useEffect, useState } from 'react';
import { BanknoteIcon, PlusIcon, WalletIcon } from 'lucide-react';
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
  getVendorPayablesByProject,
  listOpenBillsForVendor,
  listVendorPayments,
  recordVendorPayment,
  reverseVendorPayment,
  type OpenBillRow,
  type PayableByProjectRow,
  type VendorPaymentRow,
} from '@/lib/server/billing/vendor-payments';
import {
  VendorAdvanceDialog,
  VendorDebitNoteDialog,
} from '@/components/entity/vendor-adjustments-dialogs';

type DueState = { rows: readonly PayableByProjectRow[]; totalPaise: bigint };

/**
 * Vendor "Payments" tab. Records money PAID to the vendor against open bills
 * (posts a `vendor_payment_made` ledger txn via recordVendorPayment) and shows
 * a project-grouped "Due to pay" summary above the payments list.
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
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [reversing, setReversing] = useState<{ id: string; amount: bigint } | null>(null);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [debitOpen, setDebitOpen] = useState(false);

  async function reload() {
    try {
      const [p, d] = await Promise.all([
        listVendorPayments(vendorId),
        getVendorPayablesByProject(vendorId),
      ]);
      setPayments(p);
      setDue(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load payments');
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([listVendorPayments(vendorId), getVendorPayablesByProject(vendorId)])
      .then(([p, d]) => {
        if (cancelled) return;
        setPayments(p);
        setDue(d);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load payments');
      });
    return () => {
      cancelled = true;
    };
  }, [vendorId]);

  if (error) {
    return <EmptyState icon={WalletIcon} title="Could not load payments" description={error} />;
  }
  if (payments === null || due === null) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <DueToPayCard due={due} />

      <VendorAdvanceDialog
        open={advanceOpen}
        onOpenChange={setAdvanceOpen}
        vendorId={vendorId}
        vendorName={vendorName}
        onDone={() => void reload()}
      />
      <VendorDebitNoteDialog
        open={debitOpen}
        onOpenChange={setDebitOpen}
        vendorId={vendorId}
        vendorName={vendorName}
        onDone={() => void reload()}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Payments made{' '}
            <span className="text-muted-foreground text-xs font-normal">({payments.length})</span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setAdvanceOpen(true)}>
              Advance
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDebitOpen(true)}>
              Debit note
            </Button>
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <PlusIcon className="mr-1.5 size-4" aria-hidden />
              Record payment
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {payments.length === 0 ? (
            <EmptyState
              icon={BanknoteIcon}
              title="No payments recorded yet"
              description={`Record a payment made to ${vendorName}, allocate it to the open bills it settles, and it posts straight to the ledger.`}
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
                      {p.status === 'posted' ? (
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
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

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
    </div>
  );
}

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

/* -------------------------------------------------------------------------- */
/* Record vendor payment dialog                                                */
/* -------------------------------------------------------------------------- */

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function normaliseRupee(s: string): string {
  return s.replace(/[,\s]/g, '').trim();
}

function RecordVendorPaymentDialog({
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
  const [bills, setBills] = useState<readonly OpenBillRow[]>([]);
  const [bankAccountId, setBankAccountId] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [amountRupees, setAmountRupees] = useState('');
  const [notes, setNotes] = useState('');
  // Per-bill manual allocation amounts (rupee strings keyed by billTxnId).
  const [allocs, setAllocs] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setBankAccountId('');
      setPaymentDate(todayISO());
      setAmountRupees('');
      setNotes('');
      setAllocs({});
    });
    listAgencyBankAccounts()
      .then((b) => {
        if (cancelled) return;
        setBanks(b);
        if (b[0]) setBankAccountId(b[0].id);
      })
      .catch(() => {
        if (!cancelled) setBanks([]);
      });
    listOpenBillsForVendor(vendorId)
      .then((bl) => {
        if (!cancelled) setBills(bl);
      })
      .catch(() => {
        if (!cancelled) setBills([]);
      });
    return () => {
      cancelled = true;
    };
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

  const manualAllocCount = Object.values(allocs).filter((s) => s.trim()).length;

  async function submit() {
    if (!bankAccountId) {
      toast.error('Pick the bank account the money left from.');
      return;
    }
    let totalPaise: bigint;
    try {
      totalPaise = rupeesToPaise(normaliseRupee(amountRupees || '0'));
    } catch {
      toast.error('Enter a valid amount.');
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
          const paise = rupeesToPaise(normaliseRupee(val));
          if (paise <= 0n) throw new Error('Allocation amounts must be positive.');
          return { billTxnId, amountPaise: paise };
        });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Invalid allocation amount.');
      return;
    }
    const allocSum = allocations.reduce((acc, a) => acc + a.amountPaise, 0n);
    if (allocSum > totalPaise) {
      toast.error('Allocations exceed the amount paid.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await recordVendorPayment({
        vendorId,
        bankAccountId,
        paymentDate,
        totalPaise,
        notes: notes.trim() || null,
        allocations,
      });
      toast.success(
        `Payment posted (${result.voucherNumber}) — ${formatINR(result.allocatedPaise)} applied.`,
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
            Record payment made — {vendorName}
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
            Posts a payment-made entry (Dr payables / Cr bank) and generates a payment voucher.
            Allocate it to the open bills it settles, or leave the amounts blank to auto-apply
            oldest-first.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="os-field">
              <span className="os-field-label">From bank account</span>
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
              </select>
            </div>
            <div className="os-field">
              <label htmlFor="vp-amt" className="os-field-label">
                Amount ₹
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
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <div className="os-field">
              <label htmlFor="vp-date" className="os-field-label">
                Payment date
              </label>
              <input
                id="vp-date"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                disabled={submitting}
                style={osInputStyle}
              />
            </div>
            <div className="os-field">
              <label htmlFor="vp-notes" className="os-field-label">
                Notes (optional)
              </label>
              <input
                id="vp-notes"
                type="text"
                placeholder="UTR / cheque no. / memo"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={submitting}
                style={osInputStyle}
              />
            </div>
          </div>

          <div className="os-field">
            <span className="os-field-label">
              Allocate to bills{' '}
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                ({manualAllocCount > 0 ? `${manualAllocCount} selected` : 'blank = auto FIFO'})
              </span>
            </span>
            {bills.length === 0 ? (
              <p className="os-field-hint">No open bills for this vendor.</p>
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
