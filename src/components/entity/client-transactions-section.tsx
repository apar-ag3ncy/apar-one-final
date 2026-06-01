'use client';

import { useEffect, useState } from 'react';
import { PencilIcon, PlusIcon, SendIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { PostTransactionDialog } from './post-transaction-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusBadge } from '@/components/shared/status-badge';
import { ReceiptIcon } from 'lucide-react';

import {
  createClientInvoiceDraft,
  discardDraftTransaction,
  getDraftClientInvoice,
  listClientTransactions,
  updateClientInvoiceDraft,
  type ClientTransactionRow,
} from '@/lib/server/entities/client-transactions';
import {
  listEntityDocuments,
  type EntityDocumentRow,
} from '@/lib/server/entities/entity-documents';
import { formatINR } from '@/components/shared/format-inr';
import { paiseToRupees, rupeesToPaise } from '@/lib/money';

export type ClientTransactionsSectionProps = {
  clientId: string;
  clientName: string;
};

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral',
  pending_approval: 'warning',
  posted: 'success',
  reversed: 'danger',
  void: 'neutral',
};

const KIND_LABEL: Record<string, string> = {
  client_invoice: 'Client invoice',
  client_payment_received: 'Payment received',
  client_advance_received: 'Advance received',
  vendor_bill: 'Vendor bill',
  expense_on_behalf: 'Expense on behalf',
  employee_reimbursement: 'Reimbursement',
  office_expense: 'Office expense',
  journal: 'Journal voucher',
};

export function ClientTransactionsSection({
  clientId,
  clientName,
}: ClientTransactionsSectionProps) {
  const [rows, setRows] = useState<readonly ClientTransactionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [posting, setPosting] = useState<{ id: string; ref: string } | null>(null);
  // null = create-new mode; { transactionId, snapshot } = edit-existing mode.
  const [editingDraft, setEditingDraft] = useState<{ id: string; ref: string } | null>(null);
  const [discarding, setDiscarding] = useState<string | null>(null);

  async function reload() {
    try {
      const data = await listClientTransactions(clientId);
      setRows(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load transactions');
    }
  }

  useEffect(() => {
    let cancelled = false;
    listClientTransactions(clientId)
      .then((data) => {
        if (!cancelled) {
          setRows(data);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load transactions');
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (error) {
    return (
      <EmptyState icon={ReceiptIcon} title="Could not load transactions" description={error} />
    );
  }
  if (rows === null) {
    return <Skeleton className="h-32 w-full" />;
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Transactions{' '}
            <span className="text-muted-foreground text-xs font-normal">({rows.length})</span>
          </CardTitle>
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" aria-hidden />
            New invoice
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={ReceiptIcon}
              title="No transactions yet"
              description={`Issue an invoice to ${clientName}, record a payment, or post an expense-on-behalf via the Expenses tab.`}
            />
          ) : (
            <ul className="divide-y">
              {rows.map((tx) => (
                <li
                  key={tx.id}
                  className="hover:bg-muted/30 flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground font-mono text-xs">
                        {tx.reference}
                      </span>
                      <StatusBadge
                        tone={STATUS_TONE[tx.status] ?? 'neutral'}
                        label={tx.status.replace('_', ' ')}
                        dot={false}
                      />
                      {tx.flags.blocks > 0 ? (
                        <StatusBadge tone="danger" label={`${tx.flags.blocks} block`} dot={false} />
                      ) : null}
                      {tx.flags.warnings > 0 ? (
                        <StatusBadge
                          tone="warning"
                          label={`${tx.flags.warnings} warn`}
                          dot={false}
                        />
                      ) : null}
                    </div>
                    <div className="text-sm font-medium">{KIND_LABEL[tx.kind] ?? tx.kind}</div>
                    {tx.memo ? (
                      <div className="text-muted-foreground text-xs">{tx.memo}</div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <div className="font-mono text-sm tabular-nums">
                      {formatINR(tx.amountPaise)}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {new Date(tx.date).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </div>
                    {tx.status === 'draft' ? (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2"
                          onClick={() => {
                            setEditingDraft({ id: tx.id, ref: tx.reference });
                            setFormOpen(true);
                          }}
                          title="Edit draft"
                        >
                          <PencilIcon className="size-3" aria-hidden />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2"
                          onClick={async () => {
                            if (discarding) return;
                            setDiscarding(tx.id);
                            try {
                              await discardDraftTransaction(tx.id);
                              toast.success(`Discarded draft ${tx.reference}.`);
                              void reload();
                            } catch (e) {
                              toast.error(
                                e instanceof Error ? e.message : 'Could not discard draft',
                              );
                            } finally {
                              setDiscarding(null);
                            }
                          }}
                          title="Discard draft"
                          disabled={discarding === tx.id}
                        >
                          <Trash2Icon className="size-3" aria-hidden />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2"
                          onClick={() => setPosting({ id: tx.id, ref: tx.reference })}
                        >
                          <SendIcon className="mr-1 size-3" aria-hidden />
                          Post
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <NewInvoiceDialog
        open={formOpen}
        onOpenChange={(v) => {
          setFormOpen(v);
          if (!v) setEditingDraft(null);
        }}
        clientId={clientId}
        clientName={clientName}
        editDraft={editingDraft}
        onCreated={() => {
          setFormOpen(false);
          setEditingDraft(null);
          void reload();
        }}
      />

      <PostTransactionDialog
        transactionId={posting?.id ?? null}
        label={posting?.ref ?? ''}
        onOpenChange={(o) => !o && setPosting(null)}
        onPosted={() => {
          setPosting(null);
          void reload();
        }}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* New invoice dialog                                                          */
/* -------------------------------------------------------------------------- */

type LineItem = {
  description: string;
  amountRupees: string;
  gstRupees: string;
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function NewInvoiceDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
  editDraft,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  /** When set, the dialog updates an existing draft instead of creating a new one. */
  editDraft: { id: string; ref: string } | null;
  onCreated: () => void;
}) {
  const [docs, setDocs] = useState<readonly EntityDocumentRow[]>([]);
  const [docId, setDocId] = useState<string>('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [txnDate, setTxnDate] = useState(todayISO());
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: '', amountRupees: '', gstRupees: '' },
  ]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Load this client's invoice-eligible documents when the dialog opens.
  // Edit-mode (editDraft set) additionally fetches the draft's current
  // values and pre-fills every field — so the user only changes what they
  // need to change.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    if (editDraft) {
      // Pre-fill from the existing draft. The queueMicrotask reset is
      // skipped — we want the dialog to open with the draft's values,
      // not empty, then snap to them.
      void getDraftClientInvoice(editDraft.id)
        .then((draft) => {
          if (cancelled) return;
          setInvoiceNumber(draft.invoiceNumber);
          setTxnDate(draft.txnDate);
          setNotes(draft.notes ?? '');
          setDocId(draft.invoiceDocumentId);
          setLineItems(
            draft.lineItems.length > 0
              ? draft.lineItems.map((li) => ({
                  description: li.description,
                  amountRupees: paiseToRupees(li.amountPaise),
                  gstRupees:
                    li.gstAmountPaiseCaptured > 0n ? paiseToRupees(li.gstAmountPaiseCaptured) : '',
                }))
              : [{ description: '', amountRupees: '', gstRupees: '' }],
          );
        })
        .catch((e) => {
          if (!cancelled) {
            toast.error(e instanceof Error ? e.message : 'Could not load the draft to edit');
          }
        });
    } else {
      // Create mode: reset state asynchronously to avoid the cascading-
      // render lint warning and so a re-open doesn't show the previous
      // submission's values.
      queueMicrotask(() => {
        if (cancelled) return;
        setInvoiceNumber('');
        setTxnDate(todayISO());
        setLineItems([{ description: '', amountRupees: '', gstRupees: '' }]);
        setNotes('');
        setDocId('');
      });
    }

    listEntityDocuments({ entityType: 'client', entityId: clientId })
      .then((data) => {
        if (cancelled) return;
        // Only documents whose kind makes sense as an invoice source.
        const filtered = data.filter(
          (d) => d.kind === 'invoice' || d.kind === 'contract' || d.kind === 'other',
        );
        setDocs(filtered);
      })
      .catch(() => {
        // Best-effort — UI still shows an empty list with an upload hint.
        if (!cancelled) setDocs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, clientId, editDraft]);

  function addLine() {
    setLineItems((prev) => [...prev, { description: '', amountRupees: '', gstRupees: '' }]);
  }

  function updateLine(idx: number, patch: Partial<LineItem>) {
    setLineItems((prev) => prev.map((li, i) => (i === idx ? { ...li, ...patch } : li)));
  }

  function removeLine(idx: number) {
    setLineItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  async function submit() {
    if (!docId) {
      toast.error('Pick a source document — the invoice PDF you uploaded.');
      return;
    }
    if (!invoiceNumber.trim()) {
      toast.error('Invoice number is required.');
      return;
    }

    // Parse rupee strings to paise. Strip thousand-separators (comma + en/em
    // space) — Indian users routinely type ₹1,00,000 — and the underlying
    // rupeesToPaise() only accepts /^[+-]?\d+(\.\d{1,2})?$/, so without this
    // normalisation a perfectly valid amount throws an opaque parse error.
    function normaliseRupee(s: string): string {
      return s.replace(/[,   \s]/g, '').trim();
    }
    let parsedLines: Array<{
      description: string;
      amountPaise: bigint;
      gstAmountPaiseCaptured: bigint;
    }>;
    try {
      parsedLines = lineItems.map((li, i) => {
        if (!li.description.trim()) {
          throw new Error(`Line ${i + 1}: description is required`);
        }
        const amount = rupeesToPaise(normaliseRupee(li.amountRupees || '0'));
        if (amount <= 0n) {
          throw new Error(`Line ${i + 1}: amount must be positive`);
        }
        const gst = li.gstRupees ? rupeesToPaise(normaliseRupee(li.gstRupees)) : 0n;
        return {
          description: li.description.trim(),
          amountPaise: amount,
          gstAmountPaiseCaptured: gst,
        };
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Invalid line item');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        clientId,
        invoiceDocumentId: docId,
        invoiceNumber: invoiceNumber.trim(),
        txnDate,
        lineItems: parsedLines,
        notes: notes.trim() || null,
      };
      const result = editDraft
        ? await updateClientInvoiceDraft(editDraft.id, payload)
        : await createClientInvoiceDraft(payload);
      if (result.flags.length > 0) {
        const blocks = result.flags.filter((f) => f.severity === 'block').length;
        if (blocks > 0) {
          toast.warning(
            `Draft saved with ${blocks} blocking flag(s). Resolve them before posting.`,
          );
        } else {
          toast.info(
            `Draft saved with ${result.flags.length} flag(s) to acknowledge before posting.`,
          );
        }
      } else {
        toast.success(editDraft ? 'Draft updated.' : 'Invoice draft saved.');
      }
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save invoice');
    } finally {
      setSubmitting(false);
    }
  }

  // Esc to close (OS modal convention).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="os-modal-overlay"
      onMouseDown={() => {
        if (!submitting) onOpenChange(false);
      }}
    >
      <div className="os-modal" style={{ width: 720 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="os-modal-head">
          <div className="font-display" style={{ fontSize: 18 }}>
            {editDraft ? `Edit draft ${editDraft.ref}` : `New invoice — ${clientName}`}
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
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            overflowY: 'auto',
          }}
        >
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            Captured-not-computed: enter the invoice number, date, line-item net amounts, and the
            GST as it appears on the PDF. The source document is the invoice PDF; upload it via the
            Documents tab first.
          </p>

          <div className="os-field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="inv-doc" className="os-field-label">
              Source document (invoice PDF)
            </label>
            <select
              id="inv-doc"
              value={docId}
              onChange={(e) => setDocId(e.target.value)}
              disabled={submitting}
              style={osInputStyle}
            >
              <option value="">
                {docs.length === 0
                  ? 'No invoice docs found — upload one first'
                  : 'Pick the invoice PDF'}
              </option>
              {docs.map((d) => (
                <option key={d.documentId} value={d.documentId}>
                  {d.title ?? d.originalFilename}
                  {d.kind ? ` (${d.kind})` : ''}
                </option>
              ))}
            </select>
            {docs.length === 0 ? (
              <p className="os-field-hint">
                Upload an invoice document via the Documents tab first; the picker filters to
                kind=invoice / contract / other.
              </p>
            ) : null}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="os-field">
              <label htmlFor="inv-number" className="os-field-label">
                Invoice number
              </label>
              <input
                id="inv-number"
                type="text"
                placeholder="APR-2026-04-0001"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                disabled={submitting}
                style={osInputStyle}
              />
            </div>
            <div className="os-field">
              <label htmlFor="inv-date" className="os-field-label">
                Invoice date
              </label>
              <input
                id="inv-date"
                type="date"
                value={txnDate}
                onChange={(e) => setTxnDate(e.target.value)}
                disabled={submitting}
                style={osInputStyle}
              />
            </div>
          </div>

          <div className="os-field">
            <span className="os-field-label">Line items</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {lineItems.map((li, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 120px 120px auto',
                    gap: 6,
                    alignItems: 'center',
                  }}
                >
                  <input
                    type="text"
                    placeholder={`Line ${idx + 1} description`}
                    value={li.description}
                    onChange={(e) => updateLine(idx, { description: e.target.value })}
                    disabled={submitting}
                    style={osInputStyle}
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Net ₹"
                    value={li.amountRupees}
                    onChange={(e) => updateLine(idx, { amountRupees: e.target.value })}
                    disabled={submitting}
                    style={osInputStyle}
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="GST ₹"
                    value={li.gstRupees}
                    onChange={(e) => updateLine(idx, { gstRupees: e.target.value })}
                    disabled={submitting}
                    style={osInputStyle}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => removeLine(idx)}
                    disabled={submitting || lineItems.length <= 1}
                    aria-label="Remove line"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn"
                onClick={addLine}
                disabled={submitting}
                style={{ alignSelf: 'flex-start' }}
              >
                Add line
              </button>
            </div>
          </div>

          <div className="os-field">
            <label htmlFor="inv-notes" className="os-field-label">
              Notes (optional)
            </label>
            <textarea
              id="inv-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={submitting}
              style={{ ...osInputStyle, resize: 'vertical', minHeight: 60 }}
            />
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            padding: '12px 18px 14px',
            borderTop: '1px solid var(--border)',
          }}
        >
          <button
            type="button"
            className="btn"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={submit}
            disabled={submitting || !docId}
          >
            {submitting
              ? editDraft
                ? 'Saving…'
                : 'Saving draft…'
              : editDraft
                ? 'Save changes'
                : 'Save draft'}
          </button>
        </div>
      </div>
    </div>
  );
}

const osInputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--content)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 7,
  padding: '8px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
};
