'use client';

import { useEffect, useState } from 'react';
import { DownloadIcon, PlusIcon, ReceiptIcon, WalletIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusBadge } from '@/components/shared/status-badge';
import { formatINR } from '@/components/shared/format-inr';
import { rupeesToPaise } from '@/lib/money';
import { getDocumentSignedUrl } from '@/lib/server/entities/documents';
import {
  listAgencyBankAccounts,
  type AgencyBankAccountRow,
} from '@/lib/server/billing/agency-banks';
import { listBankAccounts, type BankAccountRow } from '@/lib/server/entities/bank-accounts';
import {
  getClientReceivablesByProject,
  listClientReceipts,
  listOpenInvoicesForClient,
  recordClientReceipt,
  reverseClientReceipt,
  type ClientReceiptRow,
  type OpenInvoiceRow,
  type ReceivableByProjectRow,
} from '@/lib/server/billing/client-receipts';

type DueState = {
  rows: readonly ReceivableByProjectRow[];
  totalPaise: bigint;
  // Surplus the client has paid over what we've billed — sits with us as a
  // credit balance available to set against future invoices (or refund).
  creditPaise: bigint;
};

/**
 * Client "Transactions" tab — records money RECEIVED from the client (our bank
 * or cash ↔ the client's bank), with TDS/GST, against the client's open
 * `client_invoice` ledger transactions. Posts client_payment_received and shows
 * a project-grouped "Due to collect" summary.
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
  const [invoices, setInvoices] = useState<readonly OpenInvoiceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [reversing, setReversing] = useState<{ id: string; amount: bigint } | null>(null);

  async function reload() {
    try {
      const [r, d, inv] = await Promise.all([
        listClientReceipts(clientId),
        getClientReceivablesByProject(clientId),
        listOpenInvoicesForClient(clientId),
      ]);
      setReceipts(r);
      setDue(d);
      setInvoices(inv);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load transactions');
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listClientReceipts(clientId),
      getClientReceivablesByProject(clientId),
      listOpenInvoicesForClient(clientId),
    ])
      .then(([r, d, inv]) => {
        if (cancelled) return;
        setReceipts(r);
        setDue(d);
        setInvoices(inv);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load transactions');
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  async function downloadReceipt(row: ClientReceiptRow) {
    if (!row.sourceDocumentId) {
      toast.error('No receipt voucher stored for this payment.');
      return;
    }
    try {
      const { url } = await getDocumentSignedUrl(row.sourceDocumentId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open the receipt.');
    }
  }

  if (error) {
    return <EmptyState icon={WalletIcon} title="Could not load transactions" description={error} />;
  }
  if (receipts === null || due === null || invoices === null) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <div className="flex flex-col gap-4">
      {due.creditPaise > 0n ? (
        <CreditAvailableCard creditPaise={due.creditPaise} clientName={clientName} />
      ) : null}

      <DueToCollectCard due={due} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Money received{' '}
            <span className="text-muted-foreground text-xs font-normal">({receipts.length})</span>
          </CardTitle>
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" aria-hidden />
            Record receipt
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {receipts.length === 0 ? (
            <EmptyState
              icon={ReceiptIcon}
              title="No money recorded yet"
              description={`Record money received from ${clientName} — pick the bank accounts (or cash), the amount, any TDS/GST, and the invoices it settles.`}
            />
          ) : (
            <ul className="divide-y">
              {receipts.map((r) => (
                <li key={r.transactionId} className="flex flex-col gap-1.5 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">Receipt</span>
                        <StatusBadge
                          tone={r.status === 'posted' ? 'success' : 'neutral'}
                          label={r.status}
                          dot={false}
                        />
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
                              {a.remainingOnInvoicePaise > 0n ? (
                                <span className="tabular-nums">
                                  ({formatINR(a.remainingOnInvoicePaise)} left)
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
                        {formatINR(r.amountPaise)}
                      </div>
                      <div className="text-muted-foreground text-xs">{formatDate(r.txnDate)}</div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => void downloadReceipt(r)}
                          disabled={!r.sourceDocumentId}
                          aria-label="Download receipt voucher"
                        >
                          <DownloadIcon className="mr-1 size-3.5" aria-hidden />
                          Receipt
                        </Button>
                        {r.status === 'posted' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() =>
                              setReversing({ id: r.transactionId, amount: r.amountPaise })
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

      <InvoiceDuesCard invoices={invoices} />

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

/** Shown when the client has paid us more than we've billed — the surplus is a
 * credit balance sitting with us, available to set against their next invoice
 * (or to refund). Mirrors the "Due to collect" card, opposite direction. */
function CreditAvailableCard({
  creditPaise,
  clientName,
}: {
  creditPaise: bigint;
  clientName: string;
}) {
  return (
    <Card className="border-emerald-500/40 bg-emerald-500/5">
      <CardHeader className="flex flex-row items-center gap-2">
        <WalletIcon className="size-4 text-emerald-600" aria-hidden />
        <CardTitle className="text-base text-emerald-700 dark:text-emerald-400">
          Credit balance available
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
          {formatINR(creditPaise)}
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          {`${clientName} has paid more than we've billed. This surplus is held in our accounts and can be applied to their next invoice or refunded.`}
        </p>
      </CardContent>
    </Card>
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

/** Per-invoice remaining dues — each open invoice with how much is still due
 * (captured total minus what's been received/adjusted). */
function InvoiceDuesCard({ invoices }: { invoices: readonly OpenInvoiceRow[] }) {
  const totalDue = invoices.reduce((acc, i) => acc + i.outstandingPaise, 0n);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">
          Invoice dues{' '}
          <span className="text-muted-foreground text-xs font-normal">({invoices.length})</span>
        </CardTitle>
        {invoices.length > 0 ? (
          <span className="font-mono text-sm tabular-nums">{formatINR(totalDue)} due</span>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {invoices.length === 0 ? (
          <p className="text-muted-foreground px-6 pb-4 text-sm italic">
            No open invoices — everything is cleared.
          </p>
        ) : (
          <ul className="divide-y">
            {invoices.map((inv) => {
              const paidPaise = inv.totalPaise - inv.outstandingPaise;
              const partiallyPaid = paidPaise > 0n;
              return (
                <li
                  key={inv.invoiceId}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm">{inv.documentNumber}</span>
                      <StatusBadge
                        tone={partiallyPaid ? 'info' : 'warning'}
                        label={partiallyPaid ? 'partially paid' : 'unpaid'}
                        dot={false}
                      />
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {inv.projectName ?? 'No project'} · {formatDate(inv.documentDate)}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <div className="font-mono text-sm tabular-nums">
                      {formatINR(inv.outstandingPaise)}{' '}
                      <span className="text-muted-foreground text-xs">due</span>
                    </div>
                    <div className="text-muted-foreground text-xs tabular-nums">
                      of {formatINR(inv.totalPaise)}
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
/* Record receipt dialog                                                       */
/* -------------------------------------------------------------------------- */

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function normaliseRupee(s: string): string {
  return s.replace(/[,\s]/g, '').trim();
}

/** Parse a rupee string to paise; returns 0n for blank. Throws on garbage. */
function parsePaise(s: string): bigint {
  const t = normaliseRupee(s);
  if (!t) return 0n;
  return rupeesToPaise(t);
}

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
  const [ourBanks, setOurBanks] = useState<readonly AgencyBankAccountRow[]>([]);
  const [clientBanks, setClientBanks] = useState<readonly BankAccountRow[]>([]);
  const [invoices, setInvoices] = useState<readonly OpenInvoiceRow[]>([]);
  const [mode, setMode] = useState<'bank' | 'cash'>('bank');
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
    listBankAccounts({ entityType: 'client', entityId: clientId })
      .then((b) => !cancelled && setClientBanks(b))
      .catch(() => !cancelled && setClientBanks([]));
    listOpenInvoicesForClient(clientId)
      .then((inv) => !cancelled && setInvoices(inv))
      .catch(() => !cancelled && setInvoices([]));
    return () => {
      cancelled = true;
    };
  }, [open, clientId]);

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
      toast.error('Pick the bank account the money was received into.');
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

    let allocations: Array<{ invoiceTxnId: string; amountPaise: bigint }> = [];
    try {
      allocations = Object.entries(allocs)
        .filter(([, val]) => val.trim())
        .map(([invoiceTxnId, val]) => {
          const paise = parsePaise(val);
          if (paise <= 0n) throw new Error('Allocation amounts must be positive.');
          return { invoiceTxnId, amountPaise: paise };
        });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Invalid allocation amount.');
      return;
    }
    if (allocations.reduce((a, x) => a + x.amountPaise, 0n) > totalPaise) {
      toast.error('Allocations exceed the amount received.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await recordClientReceipt({
        clientId,
        mode,
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
        `Receipt ${result.receiptNumber} posted — ${formatINR(result.allocatedPaise)} applied.`,
      );
      onRecorded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record the receipt.');
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
            Record money received — {clientName}
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
          {/* Mode toggle */}
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="os-field">
                <span className="os-field-label">Into our bank account</span>
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
                <span className="os-field-label">From client&apos;s bank (optional)</span>
                <select
                  value={counterpartyBankAccountId}
                  onChange={(e) => setCounterpartyBankAccountId(e.target.value)}
                  disabled={submitting}
                  style={osInputStyle}
                >
                  <option value="">
                    {clientBanks.length === 0 ? 'No client bank on file' : '— Not specified —'}
                  </option>
                  {clientBanks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bankName} ••{b.accountLast4}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
              Cash receipt — posts to Cash on Hand (1110).
            </p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div className="os-field">
              <label htmlFor="rcpt-date" className="os-field-label">
                Date
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
              <label htmlFor="rcpt-amt" className="os-field-label">
                Amount ₹ (gross)
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
              <label htmlFor="rcpt-gst" className="os-field-label">
                GST ₹ (incl., noted)
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="os-field">
              <label htmlFor="rcpt-tds" className="os-field-label">
                TDS withheld by client ₹
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
              <label htmlFor="rcpt-tds-sec" className="os-field-label">
                TDS section (optional)
              </label>
              <input
                id="rcpt-tds-sec"
                type="text"
                placeholder="e.g. 194J"
                value={tdsSection}
                onChange={(e) => setTdsSection(e.target.value)}
                disabled={submitting}
                style={osInputStyle}
              />
            </div>
          </div>

          {netHint !== null && netHint >= 0n && parsePaise(tdsRupees) > 0n ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
              Net cash received: <strong>{formatINR(netHint)}</strong> (amount − TDS). The full
              gross clears the invoice; TDS posts to TDS Receivable.
            </p>
          ) : null}

          <div className="os-field">
            <span className="os-field-label">
              Allocate to invoices{' '}
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                (blank = auto oldest-first)
              </span>
            </span>
            {invoices.length === 0 ? (
              <p className="os-field-hint">
                No open invoices for this client — create one in the Invoices tab to link it.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {invoices.map((inv) => (
                  <div
                    key={inv.invoiceTxnId}
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
                      value={allocs[inv.invoiceTxnId] ?? ''}
                      onChange={(e) =>
                        setAllocs((prev) => ({ ...prev, [inv.invoiceTxnId]: e.target.value }))
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
/* Reverse receipt dialog                                                      */
/* -------------------------------------------------------------------------- */

function ReverseReceiptDialog({
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
      await reverseClientReceipt(target!.id, r);
      toast.success('Receipt reversed.');
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
            Posts an offsetting entry and marks this receipt reversed (the ledger is append-only —
            nothing is deleted). Give a reason (≥10 characters).
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
