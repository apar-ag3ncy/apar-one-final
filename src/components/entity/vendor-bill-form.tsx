'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  createVendorBillDraft,
  getDraftVendorBill,
  updateVendorBillDraft,
} from '@/lib/server/entities/vendor-bills';
import {
  listEntityDocuments,
  uploadDocument,
  type EntityDocumentRow,
} from '@/lib/server/entities/entity-documents';
import { listClients } from '@/lib/server-stub/entity-actions';
import { listVendors } from '@/lib/server-stub/entity-actions';
import { listProjectOptionsForClient, type EntityOption } from '@/lib/server/entities/options';
import { paiseToRupees, rupeesToPaise } from '@/lib/money';

type LineItem = { description: string; amountRupees: string; gstRupees: string };

type Attribution = 'client' | 'opex' | 'asset' | 'other';

type DocSource = 'vendor' | 'client' | 'project';
type DocOption = EntityDocumentRow & { source: DocSource };

const DOC_SOURCE_LABEL: Record<DocSource, string> = {
  vendor: 'Vendor documents',
  client: 'Client documents',
  project: 'Project documents',
};

// Document kinds worth offering as a bill source.
const BILL_DOC_KINDS = new Set(['invoice', 'receipt', 'expense_receipt', 'other']);

const OPEX_CODES: Array<{
  value: '6100' | '6200' | '6300' | '6400' | '6900' | '8100';
  label: string;
}> = [
  { value: '6100', label: '6100 — Salaries & wages' },
  { value: '6200', label: '6200 — Rent' },
  { value: '6300', label: '6300 — Software & subscriptions' },
  { value: '6400', label: '6400 — Travel' },
  { value: '6900', label: '6900 — Other OpEx' },
  { value: '8100', label: '8100 — Capital reserves' },
];

const TDS_SECTIONS: Array<{ value: string; label: string }> = [
  { value: 'none', label: 'No TDS' },
  { value: '194C', label: '194C — Contractors' },
  { value: '194J', label: '194J — Professional fees' },
  { value: '194H', label: '194H — Commission' },
  { value: '194I', label: '194I — Rent' },
  { value: '194Q', label: '194Q — Purchase of goods' },
  { value: '194O', label: '194O — E-commerce' },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export type VendorBillFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-set vendor (when opened from vendor profile). */
  vendorId?: string;
  vendorName?: string;
  /** Pre-set client; forces attribution='client' (when opened from client profile). */
  clientId?: string;
  clientName?: string;
  /** Whether the user can change attribution. False on the client side. */
  lockAttributionToClient?: boolean;
  /** When set, edit this existing DRAFT bill in place instead of creating one. */
  editTransactionId?: string | null;
  /** Called after a successful submit (create OR update). */
  onCreated: () => void;
};

export function VendorBillForm({
  open,
  onOpenChange,
  vendorId: vendorIdProp,
  vendorName: vendorNameProp,
  clientId: clientIdProp,
  clientName: clientNameProp,
  lockAttributionToClient = false,
  editTransactionId = null,
  onCreated,
}: VendorBillFormProps) {
  const [vendorOptions, setVendorOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [clientOptions, setClientOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [docOptions, setDocOptions] = useState<readonly DocOption[]>([]);
  const [projectOptions, setProjectOptions] = useState<readonly EntityOption[]>([]);

  // SPEC-AMENDMENT-001 §3.2: attribution has NO default — the user must
  // explicitly choose between client / opex / asset. The exception is when
  // the form is opened from a client profile (clientIdProp set or
  // lockAttributionToClient): there the attribution is forced to 'client'.
  const [attribution, setAttribution] = useState<Attribution | null>(
    lockAttributionToClient || clientIdProp ? 'client' : null,
  );
  const [vendorId, setVendorId] = useState<string>(vendorIdProp ?? '');
  const [clientId, setClientId] = useState<string>(clientIdProp ?? '');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [expenseAccountCode, setExpenseAccountCode] = useState<
    '6100' | '6200' | '6300' | '6400' | '6900' | '8100'
  >('6300');
  const [billDocumentId, setBillDocumentId] = useState<string>('');
  const [vendorInvoiceNumber, setVendorInvoiceNumber] = useState('');
  const [txnDate, setTxnDate] = useState(todayISO());
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: '', amountRupees: '', gstRupees: '' },
  ]);
  const [tdsRupees, setTdsRupees] = useState('');
  const [tdsSection, setTdsSection] = useState<string>('none');
  const [isRcm, setIsRcm] = useState(false);
  const [notes, setNotes] = useState('');
  const [otherDescription, setOtherDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [docRefresh, setDocRefresh] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Pre-fetch vendor and client options + the vendor's bill documents when
  // the dialog opens. Each query is best-effort.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    if (editTransactionId) {
      // Edit mode: pre-fill every field from the existing draft. "Other" bills
      // are stored as opex/6900 with an "Other — …" notes prefix; reconstruct
      // that label so the round-trip is faithful.
      void getDraftVendorBill(editTransactionId)
        .then((d) => {
          if (cancelled) return;
          const otherPrefix = 'Other — ';
          const notesLines = (d.notes ?? '').split('\n');
          const isOther =
            d.attribution === 'opex' &&
            d.expenseAccountCode === '6900' &&
            (notesLines[0]?.startsWith(otherPrefix) ?? false);
          if (isOther) {
            setAttribution('other');
            setOtherDescription(notesLines[0]!.slice(otherPrefix.length));
            setNotes(notesLines.slice(1).join('\n'));
          } else {
            setAttribution(d.attribution);
            setOtherDescription('');
            setNotes(d.notes ?? '');
          }
          setVendorId(d.vendorId);
          setClientId(d.onBehalfOfClientId ?? '');
          setSelectedProjectId(d.projectId ?? '');
          if (
            d.expenseAccountCode &&
            ['6100', '6200', '6300', '6400', '6900', '8100'].includes(d.expenseAccountCode)
          ) {
            setExpenseAccountCode(
              d.expenseAccountCode as '6100' | '6200' | '6300' | '6400' | '6900' | '8100',
            );
          }
          setBillDocumentId(d.billDocumentId);
          setVendorInvoiceNumber(d.vendorInvoiceNumber);
          setTxnDate(d.txnDate);
          setLineItems(
            d.lineItems.length > 0
              ? d.lineItems.map((li) => ({
                  description: li.description,
                  amountRupees: paiseToRupees(li.amountPaise),
                  gstRupees:
                    li.gstAmountPaiseCaptured > 0n ? paiseToRupees(li.gstAmountPaiseCaptured) : '',
                }))
              : [{ description: '', amountRupees: '', gstRupees: '' }],
          );
          setTdsRupees(d.tdsAmountPaise > 0n ? paiseToRupees(d.tdsAmountPaise) : '');
          setTdsSection(d.tdsSection && d.tdsSection.length > 0 ? d.tdsSection : 'none');
          setIsRcm(d.isRcm);
        })
        .catch((e) => {
          if (!cancelled) {
            toast.error(e instanceof Error ? e.message : 'Could not load the draft bill');
          }
        });
    } else {
      queueMicrotask(() => {
        if (cancelled) return;
        setVendorInvoiceNumber('');
        setTxnDate(todayISO());
        setLineItems([{ description: '', amountRupees: '', gstRupees: '' }]);
        setTdsRupees('');
        setTdsSection('none');
        setIsRcm(false);
        setNotes('');
        setOtherDescription('');
        setBillDocumentId('');
        setVendorId(vendorIdProp ?? '');
        setClientId(clientIdProp ?? '');
        setSelectedProjectId('');
        setAttribution(lockAttributionToClient || clientIdProp ? 'client' : null);
      });
    }

    if (!vendorIdProp) {
      listVendors()
        .then((vs) => {
          if (!cancelled) setVendorOptions(vs.map((v) => ({ id: v.id, name: v.name })));
        })
        .catch(() => {});
    }
    if (!clientIdProp) {
      listClients()
        .then((cs) => {
          if (!cancelled) setClientOptions(cs.map((c) => ({ id: c.id, name: c.name })));
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [open, vendorIdProp, clientIdProp, lockAttributionToClient, editTransactionId]);

  // Surface every document that could be the source bill: the vendor's own
  // uploaded docs, plus — when the bill is on behalf of a client — that
  // client's docs and the selected project's docs. Merged, de-duplicated by
  // document id (most-specific source wins), and filtered to bill-like kinds.
  // Re-runs on any of those selections, and after an inline upload bumps
  // `docRefresh`.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const targets: Array<{ entityType: 'vendor' | 'client' | 'project'; entityId: string; source: DocSource }> =
      [];
    if (attribution === 'client' && selectedProjectId) {
      targets.push({ entityType: 'project', entityId: selectedProjectId, source: 'project' });
    }
    if (attribution === 'client' && clientId) {
      targets.push({ entityType: 'client', entityId: clientId, source: 'client' });
    }
    if (vendorId) {
      targets.push({ entityType: 'vendor', entityId: vendorId, source: 'vendor' });
    }
    if (targets.length === 0) {
      queueMicrotask(() => {
        if (!cancelled) setDocOptions([]);
      });
      return;
    }
    Promise.all(
      targets.map((t) =>
        listEntityDocuments({ entityType: t.entityType, entityId: t.entityId })
          .then((docs) => docs.map((d) => ({ ...d, source: t.source })))
          .catch(() => [] as DocOption[]),
      ),
    )
      .then((groups) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const merged: DocOption[] = [];
        for (const group of groups) {
          for (const d of group) {
            if (!BILL_DOC_KINDS.has(d.kind)) continue;
            if (seen.has(d.documentId)) continue;
            seen.add(d.documentId);
            merged.push(d);
          }
        }
        setDocOptions(merged);
      })
      .catch(() => {
        if (!cancelled) setDocOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, attribution, vendorId, clientId, selectedProjectId, docRefresh]);

  // Inline upload — the user can attach the bill PDF/image right here instead
  // of going to a Documents tab first. Files land under the client (for
  // client-attributed bills, so they show on the client's tab and mirror to
  // the vendor) or under the vendor otherwise, then auto-select.
  async function handleUploadBill(file: File) {
    const target =
      attribution === 'client' && clientId
        ? { entityType: 'client' as const, entityId: clientId }
        : vendorId
          ? { entityType: 'vendor' as const, entityId: vendorId }
          : null;
    if (!target) {
      toast.error(
        attribution === 'client'
          ? 'Pick the vendor and client first.'
          : 'Pick the vendor first.',
      );
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('entityType', target.entityType);
      fd.set('entityId', target.entityId);
      fd.set('kind', 'invoice');
      if (vendorInvoiceNumber.trim()) fd.set('title', vendorInvoiceNumber.trim());
      const { documentId } = await uploadDocument(fd);
      setBillDocumentId(documentId);
      setDocRefresh((n) => n + 1);
      toast.success('Bill uploaded and attached.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not upload the bill.');
    } finally {
      setUploading(false);
    }
  }

  // Load the client's active projects for the "expenses on behalf" picker.
  // Only relevant for client-attributed bills; clear (and reset the choice)
  // whenever the client changes or the attribution leaves 'client'.
  useEffect(() => {
    if (!open) return;
    if (attribution !== 'client' || !clientId) {
      queueMicrotask(() => {
        setProjectOptions([]);
        setSelectedProjectId('');
      });
      return;
    }
    let cancelled = false;
    listProjectOptionsForClient(clientId)
      .then((ps) => {
        if (cancelled) return;
        setProjectOptions(ps);
        // Keep the current selection only if it's still valid for this client
        // (so an edit-mode pre-filled project survives, but a stale one from a
        // previously-picked client is dropped).
        setSelectedProjectId((cur) => (cur && ps.some((p) => p.id === cur) ? cur : ''));
      })
      .catch(() => {
        if (!cancelled) setProjectOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, attribution, clientId]);

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
    if (!vendorId) {
      toast.error('Pick a vendor.');
      return;
    }
    if (attribution === null) {
      toast.error('Choose whether this bill is for a client, an office expense, an asset, or other.');
      return;
    }
    if (attribution === 'client' && !clientId) {
      toast.error('Pick the client this bill is on behalf of.');
      return;
    }
    if (attribution === 'other' && !otherDescription.trim()) {
      toast.error('Describe what this "Other" bill is for.');
      return;
    }
    if (!billDocumentId) {
      toast.error('Attach the bill document (PDF / image of the vendor invoice).');
      return;
    }
    if (!vendorInvoiceNumber.trim()) {
      toast.error('Vendor invoice number is required.');
      return;
    }

    // Strip thousand-separators before handing the string to rupeesToPaise
    // (which rejects anything outside /^[+-]?\d+(\.\d{1,2})?$/). Indian
    // formats like 1,00,000 are common in this UI.
    function normaliseRupee(s: string): string {
      return s.replace(/[,   \s]/g, '').trim();
    }
    let parsedLines: Array<{
      description: string;
      amountPaise: bigint;
      gstAmountPaiseCaptured: bigint;
    }>;
    try {
      parsedLines = lineItems.map((li, i) => {
        if (!li.description.trim()) throw new Error(`Line ${i + 1}: description required`);
        const amount = rupeesToPaise(normaliseRupee(li.amountRupees || '0'));
        if (amount <= 0n) throw new Error(`Line ${i + 1}: amount must be positive`);
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

    const tdsAmountPaise =
      attribution !== 'asset' && tdsRupees ? rupeesToPaise(normaliseRupee(tdsRupees)) : 0n;
    const effectiveTdsSection = tdsSection === 'none' ? undefined : tdsSection;

    setSubmitting(true);
    try {
      // "Other" is recorded as an Other-operating-expense (6900) bill, with the
      // user's required description captured in the notes so the books always
      // say what it was for.
      const combinedNotes =
        [attribution === 'other' ? `Other — ${otherDescription.trim()}` : '', notes.trim()]
          .filter(Boolean)
          .join('\n') || null;
      const common = {
        vendorId,
        billDocumentId,
        vendorInvoiceNumber: vendorInvoiceNumber.trim(),
        txnDate,
        lineItems: parsedLines,
        isRcm,
        notes: combinedNotes,
      };
      let payload: Parameters<typeof createVendorBillDraft>[0];
      if (attribution === 'client') {
        payload = {
          attribution: 'client',
          ...common,
          onBehalfOfClientId: clientId,
          projectId: selectedProjectId || undefined,
          tdsAmountPaise,
          ...(effectiveTdsSection ? { tdsSection: effectiveTdsSection } : {}),
        };
      } else if (attribution === 'opex' || attribution === 'other') {
        payload = {
          attribution: 'opex',
          ...common,
          expenseAccountCode: attribution === 'other' ? '6900' : expenseAccountCode,
          tdsAmountPaise,
          ...(effectiveTdsSection ? { tdsSection: effectiveTdsSection } : {}),
        };
      } else {
        payload = { attribution: 'asset', ...common };
      }
      const result = editTransactionId
        ? await updateVendorBillDraft(editTransactionId, payload)
        : await createVendorBillDraft(payload);
      if (result.flags.length > 0) {
        const blocks = result.flags.filter((f) => f.severity === 'block').length;
        if (blocks > 0) {
          toast.warning(`Saved with ${blocks} blocking flag(s). Resolve before posting.`);
        } else {
          toast.info(`Saved with ${result.flags.length} flag(s) to acknowledge before posting.`);
        }
      } else {
        toast.success(editTransactionId ? 'Vendor bill updated.' : 'Vendor bill draft saved.');
      }
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save bill');
    } finally {
      setSubmitting(false);
    }
  }

  const titleSuffix =
    attribution === 'client'
      ? clientNameProp
        ? ` — on behalf of ${clientNameProp}`
        : ''
      : attribution === 'opex'
        ? ' — OpEx'
        : attribution === 'asset'
          ? ' — Asset'
          : attribution === 'other'
            ? ' — Other'
            : '';

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
            {editTransactionId ? 'Edit vendor bill' : 'New vendor bill'}
            {titleSuffix}
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
            §0.6: every vendor bill carries an explicit attribution. Apar never multiplies a tax
            rate by a base — enter the amounts as printed on the vendor&apos;s invoice.
          </p>

          {/* Attribution */}
          <div className="os-field">
            <span className="os-field-label">This bill is for</span>
            {lockAttributionToClient ? (
              <p
                style={{
                  background: 'var(--content-2)',
                  color: 'var(--text-muted)',
                  borderRadius: 7,
                  padding: '8px 10px',
                  fontSize: 13,
                  margin: 0,
                }}
              >
                On behalf of <strong style={{ color: 'var(--text)' }}>{clientNameProp}</strong> —
                billed back via the AR ledger (5100 Vendor Costs).
              </p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {(['client', 'opex', 'asset', 'other'] as Attribution[]).map((a) => {
                  const selected = attribution === a;
                  return (
                    <label
                      key={a}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        padding: '8px 10px',
                        borderRadius: 7,
                        cursor: 'pointer',
                        border: `1px solid ${selected ? 'var(--apar-red, #E63A1F)' : 'var(--border)'}`,
                        background: selected ? 'rgba(230, 58, 31, 0.08)' : 'transparent',
                      }}
                    >
                      <input
                        type="radio"
                        name="attribution"
                        value={a}
                        checked={selected}
                        onChange={() => setAttribution(a)}
                        style={{
                          position: 'absolute',
                          width: 1,
                          height: 1,
                          padding: 0,
                          margin: -1,
                          overflow: 'hidden',
                          clip: 'rect(0, 0, 0, 0)',
                          whiteSpace: 'nowrap',
                          border: 0,
                        }}
                      />
                      <span style={{ fontSize: 13, fontWeight: 500 }}>
                        {a === 'client'
                          ? 'For a client'
                          : a === 'opex'
                            ? 'Office expense'
                            : a === 'asset'
                              ? 'Asset'
                              : 'Other'}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {a === 'client'
                          ? '5100 + bill-back via AR'
                          : a === 'opex'
                            ? '6xxx office cost'
                            : a === 'asset'
                              ? '1510 capital'
                              : 'Anything else — describe it'}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* Vendor */}
            <div className="os-field">
              <span className="os-field-label">Vendor</span>
              {vendorIdProp ? (
                <p
                  style={{
                    background: 'var(--content-2)',
                    borderRadius: 7,
                    padding: '8px 10px',
                    fontSize: 13,
                    margin: 0,
                  }}
                >
                  {vendorNameProp}
                </p>
              ) : (
                <select
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  disabled={submitting}
                  style={osInputStyle}
                >
                  <option value="">Pick a vendor</option>
                  {vendorOptions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Client / Expense / Asset second pane */}
            {attribution === 'client' ? (
              <div className="os-field">
                <span className="os-field-label">On behalf of client</span>
                {clientIdProp ? (
                  <p
                    style={{
                      background: 'var(--content-2)',
                      borderRadius: 7,
                      padding: '8px 10px',
                      fontSize: 13,
                      margin: 0,
                    }}
                  >
                    {clientNameProp}
                  </p>
                ) : (
                  <select
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    disabled={submitting}
                    style={osInputStyle}
                  >
                    <option value="">Pick a client</option>
                    {clientOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : attribution === 'opex' ? (
              <div className="os-field">
                <span className="os-field-label">Expense account</span>
                <select
                  value={expenseAccountCode}
                  onChange={(e) =>
                    setExpenseAccountCode(e.target.value as typeof expenseAccountCode)
                  }
                  disabled={submitting}
                  style={osInputStyle}
                >
                  {OPEX_CODES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : attribution === 'asset' ? (
              <div className="os-field">
                <span className="os-field-label">Asset class</span>
                <p
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 7,
                    padding: '8px 10px',
                    fontSize: 11.5,
                    color: 'var(--text-muted)',
                    margin: 0,
                  }}
                >
                  Posts to 1510 Capital Assets. Capitalization threshold ₹5,000 is the caller&apos;s
                  responsibility.
                </p>
              </div>
            ) : attribution === 'other' ? (
              <div className="os-field">
                <span className="os-field-label">What is this for?</span>
                <input
                  type="text"
                  placeholder="e.g. Diwali gifting, legal retainer…"
                  value={otherDescription}
                  onChange={(e) => setOtherDescription(e.target.value)}
                  disabled={submitting}
                  style={osInputStyle}
                />
                <p className="os-field-hint">Recorded under 6900 Other operating expense.</p>
              </div>
            ) : (
              <div className="os-field">
                <span className="os-field-label">&nbsp;</span>
                <p
                  style={{
                    fontSize: 11.5,
                    color: 'var(--text-muted)',
                    margin: 0,
                    paddingTop: 8,
                  }}
                >
                  Choose an attribution above to continue.
                </p>
              </div>
            )}
          </div>

          {/* Project (expenses on behalf) — only when billing on behalf of a
              known client. Scopes the bill to one of that client's projects. */}
          {attribution === 'client' && clientId ? (
            <div className="os-field">
              <span className="os-field-label">Project (optional)</span>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                disabled={submitting}
                style={osInputStyle}
              >
                <option value="">— No project —</option>
                {projectOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sub ? `${p.label} (${p.sub})` : p.label}
                  </option>
                ))}
              </select>
              <p className="os-field-hint">
                Link this client-billed expense to one of the client&apos;s active projects.
              </p>
            </div>
          ) : null}

          {/* Source document — pick an existing doc OR upload one inline */}
          <div className="os-field">
            <span className="os-field-label">Source document (vendor invoice / bill)</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <select
                value={billDocumentId}
                onChange={(e) => setBillDocumentId(e.target.value)}
                disabled={submitting || uploading}
                style={{ ...osInputStyle, flex: 1 }}
              >
                <option value="">
                  {docOptions.length === 0
                    ? 'No documents yet — upload the bill →'
                    : 'Pick an existing document'}
                </option>
                {(['project', 'client', 'vendor'] as DocSource[]).map((src) => {
                  const inGroup = docOptions.filter((d) => d.source === src);
                  if (inGroup.length === 0) return null;
                  return (
                    <optgroup key={src} label={DOC_SOURCE_LABEL[src]}>
                      {inGroup.map((d) => (
                        <option key={d.documentId} value={d.documentId}>
                          {d.title ?? d.originalFilename} ({d.kind})
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUploadBill(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={
                  submitting ||
                  uploading ||
                  (attribution === 'client' ? !clientId || !vendorId : !vendorId)
                }
                style={{ whiteSpace: 'nowrap' }}
              >
                {uploading ? 'Uploading…' : 'Upload bill'}
              </button>
            </div>
            <p className="os-field-hint">
              {attribution === 'client'
                ? 'Showing documents from the project, client and vendor — or upload the bill right here.'
                : 'Showing the vendor’s documents — or upload the bill right here; no need to add it elsewhere first.'}
            </p>
          </div>

          {/* Invoice number + date */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="os-field">
              <label htmlFor="vb-num" className="os-field-label">
                Vendor&apos;s invoice number
              </label>
              <input
                id="vb-num"
                type="text"
                placeholder="INV/2026/04/0023"
                value={vendorInvoiceNumber}
                onChange={(e) => setVendorInvoiceNumber(e.target.value)}
                disabled={submitting}
                style={osInputStyle}
              />
            </div>
            <div className="os-field">
              <label htmlFor="vb-date" className="os-field-label">
                Bill date
              </label>
              <input
                id="vb-date"
                type="date"
                value={txnDate}
                onChange={(e) => setTxnDate(e.target.value)}
                disabled={submitting}
                style={osInputStyle}
              />
            </div>
          </div>

          {/* Line items */}
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

          {/* TDS (not for asset) */}
          {attribution !== 'asset' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="os-field">
                <label htmlFor="vb-tds-amt" className="os-field-label">
                  TDS deducted (₹, optional)
                </label>
                <input
                  id="vb-tds-amt"
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
                <span className="os-field-label">TDS section</span>
                <select
                  value={tdsSection}
                  onChange={(e) => setTdsSection(e.target.value)}
                  disabled={submitting}
                  style={osInputStyle}
                >
                  {TDS_SECTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={isRcm}
              onChange={(e) => setIsRcm(e.target.checked)}
              disabled={submitting}
              style={{ cursor: 'pointer' }}
            />
            Reverse-charge mechanism (RCM)
          </label>

          <div className="os-field">
            <label htmlFor="vb-notes" className="os-field-label">
              Notes (optional)
            </label>
            <textarea
              id="vb-notes"
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
            disabled={submitting || !billDocumentId}
          >
            {submitting
              ? editTransactionId
                ? 'Saving…'
                : 'Saving draft…'
              : editTransactionId
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
