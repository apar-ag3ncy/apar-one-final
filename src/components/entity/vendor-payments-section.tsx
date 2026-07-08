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
import { listBankAccounts, type BankAccountRow } from '@/lib/server/entities/bank-accounts';
import { useEntityMutation } from '@/components/os/auth/entity-mutation-gate';
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
  // OS read-only bridge — permissive outside the OS. Recording a payment is an
  // edit; reversing a posted payment is destructive (delete grant).
  const { canEdit, canDelete } = useEntityMutation();

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
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <PlusIcon className="mr-1.5 size-4" aria-hidden />
              Record payment
            </Button>
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId: string;
  vendorName: string;
  onRecorded: () => void;
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
      setAmountRupees('');
      setTdsRupees('');
      setTdsSection('');
      setGstRupees('');
      setAllocs({});
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

    setSubmitting(true);
    try {
      const result = await recordVendorPayment({
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
            Record money paid — {vendorName}
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
                <input
                  type="date"
                  value={chequeDate}
                  onChange={(e) => setChequeDate(e.target.value)}
                  disabled={submitting}
                  style={osInputStyle}
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
            {submitting ? 'Recording…' : 'Record & post'}
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
