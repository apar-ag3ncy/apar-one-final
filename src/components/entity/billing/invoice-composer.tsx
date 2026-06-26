'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DownloadIcon, EyeIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PdfJsViewer } from '@/components/entity/pdfjs-viewer';
import { formatINR, paiseToRupees, rupeesToPaise } from '@/lib/money';
import {
  createDraftInvoice,
  getInvoice,
  getNextInvoiceNumber,
  updateDraftInvoice,
  type CreateInvoiceInput,
} from '@/lib/server/billing/invoices';
import { renderInvoicePreview } from '@/lib/server/billing/invoice-preview';
import { sendInvoice } from '@/lib/server/billing/invoice-transitions';
import { getDocumentSignedUrl } from '@/lib/server/entities/documents';
import { listProjectOptionsForClient, type EntityOption } from '@/lib/server/entities/options';
import { listAddresses, type AddressRow } from '@/lib/server/entities/addresses';
import type { InvoiceThemeSummary } from '@/lib/server/billing/invoice-themes';
import type { CompanyBankAccountOption } from '@/lib/server/settings/company';
import { GST_STATES_BY_NAME, stateNameFromCode } from '@/lib/india/gst-states';

/* -------------------------------------------------------------------------- */
/* Line model                                                                 */
/* -------------------------------------------------------------------------- */

type LineDraft = {
  id: string;
  description: string;
  sacCode: string;
  qty: string;
  rate: string; // rupees, as typed
  taxPct: string; // e.g. "18"
};

function emptyLine(): LineDraft {
  return {
    id: crypto.randomUUID(),
    description: '',
    sacCode: '',
    qty: '1',
    rate: '',
    taxPct: '18',
  };
}

/** Rupees string → paise, never throwing (invalid → 0n). */
function toPaise(rupees: string): bigint {
  try {
    return rupeesToPaise(rupees.trim() === '' ? '0' : rupees.trim());
  } catch {
    return 0n;
  }
}

type ComputedLine = {
  qty: number;
  ratePaise: bigint;
  taxableValuePaise: bigint;
  taxBps: number;
  taxAmountPaise: bigint;
};

function computeLine(l: LineDraft): ComputedLine {
  const qty = Math.max(1, Math.trunc(Number(l.qty) || 0) || 1);
  const ratePaise = toPaise(l.rate);
  const taxableValuePaise = ratePaise * BigInt(qty);
  const taxBps = Math.max(0, Math.min(10000, Math.round((Number(l.taxPct) || 0) * 100)));
  const taxAmountPaise = (taxableValuePaise * BigInt(taxBps)) / 10000n;
  return { qty, ratePaise, taxableValuePaise, taxBps, taxAmountPaise };
}

/* -------------------------------------------------------------------------- */
/* Header pickers                                                              */
/* -------------------------------------------------------------------------- */

/** Radix Select forbids an empty-string item value, so the "no project"
 *  option uses this sentinel; it maps back to `null` on submit. */
const NO_PROJECT = '__none__';

/** Sentinel for "print the primary account" — maps back to `null` (the renderer
 *  then resolves the primary account at generation time). */
const BANK_PRIMARY = '__primary__';

/** "billing — 12 MG Road, Pune 27" style label for a bill-to option. */
function addressLabel(a: AddressRow): string {
  const where = [a.line1, [a.city, a.stateCode].filter(Boolean).join(' ')]
    .filter((s) => s.trim().length > 0)
    .join(', ');
  return `${a.kind} — ${where}`;
}

/* -------------------------------------------------------------------------- */
/* Composer dialog                                                            */
/* -------------------------------------------------------------------------- */

export type InvoiceComposerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  /** Apar's own 2-digit state code; place-of-supply matching it ⇒ CGST+SGST. */
  supplierStateCode?: string;
  /** The client's GST state code (derived from their GSTIN/address). Place of
   *  supply pre-fills to this — the recipient's state. */
  clientStateCode?: string | null;
  themes: InvoiceThemeSummary[];
  defaultThemeId?: string | null;
  /** The agency's bank accounts, for the "which account to print" picker. */
  bankAccounts?: CompanyBankAccountOption[];
  /** When set, edit an existing draft instead of creating a new one. */
  existingInvoiceId?: string | null;
  /** Called after a successful finalise (send), so the host reloads its list. */
  onFinalized: () => void;
};

const TODAY_ISO = (): string => {
  // Local date as YYYY-MM-DD (no Date.now in shared utils, but the browser is fine here).
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function InvoiceComposerDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
  supplierStateCode = '27',
  clientStateCode,
  themes,
  defaultThemeId,
  bankAccounts = [],
  existingInvoiceId,
  onFinalized,
}: InvoiceComposerDialogProps) {
  const [stage, setStage] = useState<'edit' | 'preview'>('edit');
  const [draftId, setDraftId] = useState<string | null>(existingInvoiceId ?? null);
  const [busy, setBusy] = useState<null | 'preview' | 'finalize' | 'loading'>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Form state.
  const [documentDate, setDocumentDate] = useState(TODAY_ISO());
  const [dueDate, setDueDate] = useState('');
  const [placeOfSupply, setPlaceOfSupply] = useState(clientStateCode ?? '');
  const [terms, setTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [themeId, setThemeId] = useState<string>('');
  const [bankAccountId, setBankAccountId] = useState<string>(BANK_PRIMARY);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  // Document type (invoice vs proforma) and the editable document number.
  const [documentType, setDocumentType] = useState<'invoice' | 'proforma'>('invoice');
  const [documentNumber, setDocumentNumber] = useState('');
  // The auto-suggested next number for the current FY; used to flag an
  // out-of-sequence manual override (non-blocking).
  const [suggestedNumber, setSuggestedNumber] = useState('');
  // Mirrors the latest suggested number so the FY-refetch effect can decide
  // whether the field still holds the auto value (and may auto-advance) without
  // nesting state setters or re-running on every keystroke.
  const suggestedNumberRef = useRef('');
  useEffect(() => {
    suggestedNumberRef.current = suggestedNumber;
  }, [suggestedNumber]);

  // Bill-to address + project options, scoped to this client.
  const [addresses, setAddresses] = useState<readonly AddressRow[]>([]);
  const [billToAddressId, setBillToAddressId] = useState<string | null>(null);
  const [projectOptions, setProjectOptions] = useState<readonly EntityOption[]>([]);

  // (Re)initialise when the dialog opens. For an existing draft, hydrate from
  // the DB; for a new invoice, reset to a single empty line.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Defer all initial state writes off the synchronous effect body (the repo
    // lint forbids synchronous setState in effects — see documents-section).
    queueMicrotask(() => {
      if (cancelled) return;
      setStage('edit');
      setPreviewUrl(null);
      setDraftId(existingInvoiceId ?? null);

      if (existingInvoiceId) {
        setBusy('loading');
        getInvoice(existingInvoiceId)
          .then((res) => {
            if (cancelled || !res) return;
            const { invoice, lines: ls } = res;
            setDocumentDate(invoice.documentDate);
            setDueDate(invoice.dueDate ?? '');
            setPlaceOfSupply(invoice.placeOfSupply ?? clientStateCode ?? '');
            setTerms(invoice.terms ?? '');
            setNotes(invoice.notes ?? '');
            setThemeId(invoice.themeId ?? '');
            setBankAccountId(invoice.bankAccountId ?? BANK_PRIMARY);
            setProjectId(invoice.projectId ?? null);
            setDocumentType(invoice.documentType);
            setDocumentNumber(invoice.documentNumber);
            setSuggestedNumber(invoice.documentNumber);
            setBillToAddressId(invoice.billToAddressId ?? null);
            setLines(
              ls.length > 0
                ? ls.map((l) => ({
                    id: crypto.randomUUID(),
                    description: l.description,
                    sacCode: l.sacCode ?? '',
                    qty: String(l.qty),
                    rate: paiseToRupees(l.ratePaise),
                    taxPct: String(l.capturedTaxRateBps / 100),
                  }))
                : [emptyLine()],
            );
          })
          .catch((e: unknown) =>
            toast.error(e instanceof Error ? e.message : 'Could not load invoice'),
          )
          .finally(() => {
            if (!cancelled) setBusy(null);
          });
      } else {
        const today = TODAY_ISO();
        setDocumentDate(today);
        setDueDate('');
        setPlaceOfSupply(clientStateCode ?? '');
        setTerms('');
        setNotes('');
        setThemeId(defaultThemeId ?? '');
        setBankAccountId(BANK_PRIMARY);
        setProjectId(null);
        setDocumentType('invoice');
        setDocumentNumber('');
        setSuggestedNumber('');
        setBillToAddressId(null);
        setLines([emptyLine()]);
        // Pre-fill the editable number with the next FY series number.
        getNextInvoiceNumber(today)
          .then((r) => {
            if (cancelled) return;
            setSuggestedNumber(r.documentNumber);
            setDocumentNumber(r.documentNumber);
          })
          .catch(() => {
            /* non-fatal: the field stays editable and blank */
          });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, existingInvoiceId, supplierStateCode, clientStateCode, defaultThemeId]);

  // Load this client's projects + bill-to addresses for the header pickers.
  // On create, default bill-to to the primary (else first) address.
  useEffect(() => {
    if (!open || !clientId) return;
    let cancelled = false;
    listProjectOptionsForClient(clientId)
      .then((opts) => {
        if (!cancelled) setProjectOptions(opts);
      })
      .catch(() => {
        if (!cancelled) setProjectOptions([]);
      });
    listAddresses({ entityType: 'client', entityId: clientId })
      .then((rows) => {
        if (cancelled) return;
        setAddresses(rows);
        if (!existingInvoiceId) {
          const primary = rows.find((a) => a.isPrimary) ?? rows[0] ?? null;
          setBillToAddressId(primary?.id ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) setAddresses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, clientId, existingInvoiceId]);

  // Best-effort: when the document date's FY changes (create mode only), refetch
  // the suggested next number so the out-of-sequence hint stays accurate.
  useEffect(() => {
    // Stop once a draft exists (existingInvoiceId, or draftId after the first
    // preview/save) so a preview/save never silently re-advances the number the
    // user is looking at. `busy` is deliberately NOT a dependency for the same
    // reason — its toggling must not re-run this effect.
    if (!open || existingInvoiceId || draftId) return;
    let cancelled = false;
    const prevSuggested = suggestedNumberRef.current;
    getNextInvoiceNumber(documentDate)
      .then((r) => {
        if (cancelled) return;
        setSuggestedNumber(r.documentNumber);
        // Only auto-advance the field if the user hadn't diverged from the
        // previous suggestion (i.e. they're still on the auto value).
        setDocumentNumber((cur) => (cur === prevSuggested || cur === '' ? r.documentNumber : cur));
      })
      .catch(() => {
        /* non-fatal */
      });
    return () => {
      cancelled = true;
    };
  }, [documentDate, open, existingInvoiceId, draftId]);

  // Revoke object URLs to avoid leaks.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const computed = useMemo(() => lines.map(computeLine), [lines]);
  const intraState = placeOfSupply.trim() === supplierStateCode.trim();

  // Non-blocking out-of-sequence hint. The invoice number is NEVER locked to a
  // format — any value is accepted and stored verbatim. We only nudge when the
  // user stays inside the auto series (same non-numeric stem as the suggestion)
  // but picks a different trailing number, since that's the only case where a
  // "gap in the series" is meaningful. An intentional custom format (different
  // stem, e.g. "ABC-001" vs "INV/2026-27/0001") is left alone.
  const outOfSequence = (() => {
    const sug = suggestedNumber.trim();
    const cur = documentNumber.trim();
    if (!sug || !cur || cur === sug) return false;
    const stem = (s: string) => s.replace(/\d+\s*$/, '');
    const sugStem = stem(sug);
    return sugStem.length > 0 && sugStem === stem(cur);
  })();

  // Non-blocking: when the chosen bill-to address carries its own GSTIN whose
  // state differs from the place of supply, flag it — place of supply drives the
  // CGST/SGST-vs-IGST split, so a mismatch usually means one of them is wrong.
  const billToMismatchState = (() => {
    if (!billToAddressId || placeOfSupply.trim() === '') return null;
    const addr = addresses.find((a) => a.id === billToAddressId);
    const addrState = addr?.gstin && addr.gstin.length >= 2 ? addr.gstin.slice(0, 2) : null;
    if (addrState && addrState !== placeOfSupply.trim()) {
      return stateNameFromCode(addrState) ?? addrState;
    }
    return null;
  })();

  const totals = useMemo(() => {
    const subtotal = computed.reduce((a, c) => a + c.taxableValuePaise, 0n);
    const taxTotal = computed.reduce((a, c) => a + c.taxAmountPaise, 0n);
    const cgst = intraState ? taxTotal / 2n : 0n;
    const sgst = intraState ? taxTotal - cgst : 0n;
    const igst = intraState ? 0n : taxTotal;
    return { subtotal, taxTotal, total: subtotal + taxTotal, cgst, sgst, igst };
  }, [computed, intraState]);

  function setLine(id: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }
  function removeLine(id: string) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.id !== id)));
  }

  /** Persist the draft (create or update) and return its id. */
  async function persistDraft(): Promise<string | null> {
    const validLines = lines.filter((l) => l.description.trim().length > 0);
    if (validLines.length === 0) {
      toast.error('Add at least one line with a description.');
      return null;
    }
    if (totals.total <= 0n) {
      toast.error('Invoice total must be greater than zero. Add a rate to your lines.');
      return null;
    }
    if (placeOfSupply.trim() === '') {
      toast.error('Select the place of supply (the client’s state).');
      return null;
    }

    const payloadLines = lines
      .filter((l) => l.description.trim().length > 0)
      .map((l, i) => {
        const c = computeLine(l);
        return {
          lineNo: i + 1,
          description: l.description.trim(),
          sacCode: l.sacCode.trim() === '' ? null : l.sacCode.trim(),
          qty: c.qty,
          ratePaise: c.ratePaise,
          capturedTaxableValuePaise: c.taxableValuePaise,
          capturedTaxRateBps: c.taxBps,
          capturedTaxAmountPaise: c.taxAmountPaise,
        };
      });

    const base: Omit<CreateInvoiceInput, 'idempotencyKey'> = {
      clientId,
      projectId,
      documentType,
      documentNumber: documentNumber.trim() === '' ? null : documentNumber.trim(),
      billToAddressId: addresses.length >= 2 ? billToAddressId : null,
      documentDate,
      dueDate: dueDate.trim() === '' ? null : dueDate,
      subtotalPaise: totals.subtotal,
      capturedTaxTotalPaise: totals.taxTotal,
      capturedTotalPaise: totals.total,
      placeOfSupply: placeOfSupply.trim() === '' ? null : placeOfSupply.trim(),
      capturedTaxSplit: {
        cgst_paise: totals.cgst,
        sgst_paise: totals.sgst,
        igst_paise: totals.igst,
        cess_paise: 0n,
      },
      terms: terms.trim() === '' ? null : terms.trim(),
      notes: notes.trim() === '' ? null : notes.trim(),
      themeId: themeId === '' ? null : themeId,
      bankAccountId: bankAccountId === BANK_PRIMARY ? null : bankAccountId,
      lines: payloadLines,
    };

    if (draftId) {
      await updateDraftInvoice(draftId, base);
      return draftId;
    }
    const res = await createDraftInvoice({ ...base, idempotencyKey: crypto.randomUUID() });
    setDraftId(res.id);
    return res.id;
  }

  async function onGeneratePreview() {
    setBusy('preview');
    try {
      const id = await persistDraft();
      if (!id) return;
      const { base64 } = await renderInvoicePreview(id);
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setStage('preview');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate preview');
    } finally {
      setBusy(null);
    }
  }

  async function onSaveAndDownload() {
    if (!draftId) return;
    setBusy('finalize');
    try {
      const res = await sendInvoice(draftId);
      // Finalised + posted + immutable. Fetch the stored PDF and download it.
      try {
        const { url } = await getDocumentSignedUrl(res.documentId);
        window.open(url, '_blank', 'noopener,noreferrer');
      } catch {
        toast.message('Invoice saved. Open it from the list to download.');
      }
      toast.success('Invoice saved and finalised.');
      onFinalized();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not finalise invoice');
    } finally {
      setBusy(null);
    }
  }

  const taxLabel = intraState ? 'CGST + SGST (intra-state)' : 'IGST (inter-state)';

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {stage === 'preview' ? 'Preview invoice' : draftId ? 'Edit invoice' : 'New invoice'} —{' '}
            {clientName}
          </DialogTitle>
          <DialogDescription>
            {stage === 'preview'
              ? 'Review the generated PDF. If it looks right, save & download — this posts the invoice and makes it immutable.'
              : 'Enter line items and GST details, pick a theme, then generate a preview.'}
          </DialogDescription>
        </DialogHeader>

        {stage === 'preview' ? (
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
            {previewUrl ? (
              <PdfJsViewer url={previewUrl} />
            ) : (
              <div className="text-muted-foreground p-6 text-sm">Rendering…</div>
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {/* Document type + number */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="grid gap-1.5">
                <Label htmlFor="inv-type">Document type</Label>
                <Select
                  value={documentType}
                  onValueChange={(v) => setDocumentType(v as 'invoice' | 'proforma')}
                >
                  <SelectTrigger id="inv-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="invoice">Invoice</SelectItem>
                    <SelectItem value="proforma">Proforma</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5 sm:col-span-3">
                <Label htmlFor="inv-number">Invoice number</Label>
                <Input
                  id="inv-number"
                  value={documentNumber}
                  placeholder={suggestedNumber || 'Auto-allocated on save'}
                  onChange={(e) => setDocumentNumber(e.target.value)}
                />
                {outOfSequence ? (
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    This is out of sequence — make sure it doesn’t leave a gap (next in series:{' '}
                    {suggestedNumber}).
                  </p>
                ) : null}
              </div>
            </div>

            {/* Header fields */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="grid gap-1.5">
                <Label htmlFor="inv-date">Invoice date</Label>
                <Input
                  id="inv-date"
                  type="date"
                  value={documentDate}
                  onChange={(e) => setDocumentDate(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="inv-due">Due date</Label>
                <Input
                  id="inv-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="inv-pos">Place of supply</Label>
                <Select value={placeOfSupply} onValueChange={setPlaceOfSupply}>
                  <SelectTrigger id="inv-pos">
                    <SelectValue placeholder="Select state" />
                  </SelectTrigger>
                  <SelectContent>
                    {GST_STATES_BY_NAME.map((s) => (
                      <SelectItem key={s.code} value={s.code}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="inv-theme">Theme</Label>
                <Select value={themeId} onValueChange={setThemeId}>
                  <SelectTrigger id="inv-theme">
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent>
                    {themes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                        {t.isDefault ? ' (default)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Project + bill-to address */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="inv-project">Project</Label>
                <Select
                  value={projectId ?? NO_PROJECT}
                  onValueChange={(v) => setProjectId(v === NO_PROJECT ? null : v)}
                >
                  <SelectTrigger id="inv-project">
                    <SelectValue placeholder="— No project —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PROJECT}>— No project —</SelectItem>
                    {projectOptions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                        {p.sub ? ` (${p.sub})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {addresses.length >= 2 ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="inv-billto">Bill to</Label>
                  <Select
                    value={billToAddressId ?? undefined}
                    onValueChange={(v) => setBillToAddressId(v)}
                  >
                    <SelectTrigger id="inv-billto">
                      <SelectValue placeholder="Select address" />
                    </SelectTrigger>
                    <SelectContent>
                      {addresses.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {addressLabel(a)}
                          {a.isPrimary ? ' (primary)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {billToMismatchState ? (
                    <p className="text-xs text-amber-600">
                      Bill-to GSTIN is registered in {billToMismatchState}, which differs from the
                      selected place of supply — confirm the place of supply and the CGST/SGST vs
                      IGST split.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* Which company bank account prints in the payment block. */}
            {bankAccounts.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="inv-bank">Bank account</Label>
                  <Select value={bankAccountId} onValueChange={setBankAccountId}>
                    <SelectTrigger id="inv-bank">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={BANK_PRIMARY}>Default (primary account)</SelectItem>
                      {bankAccounts.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.label}
                          {b.isPrimary ? ' (primary)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    The account shown in this invoice’s payment / bank-details block.
                  </p>
                </div>
              </div>
            ) : null}

            {/* Lines */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Line items</Label>
                <span className="text-muted-foreground text-xs">{taxLabel}</span>
              </div>
              <div className="overflow-hidden rounded-md border">
                <div className="bg-muted/40 text-muted-foreground grid grid-cols-[1fr_70px_60px_90px_56px_40px] items-center gap-2 px-2 py-1.5 text-xs font-medium">
                  <span>Description</span>
                  <span>SAC</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">Rate ₹</span>
                  <span className="text-right">Tax %</span>
                  <span />
                </div>
                {lines.map((l) => (
                  <div
                    key={l.id}
                    className="grid grid-cols-[1fr_70px_60px_90px_56px_40px] items-center gap-2 border-t px-2 py-1.5"
                  >
                    <Input
                      aria-label="Description"
                      value={l.description}
                      placeholder="Brand identity refresh"
                      onChange={(e) => setLine(l.id, { description: e.target.value })}
                    />
                    <Input
                      aria-label="SAC"
                      value={l.sacCode}
                      placeholder="9983"
                      onChange={(e) =>
                        setLine(l.id, { sacCode: e.target.value.replace(/\D/g, '').slice(0, 8) })
                      }
                    />
                    <Input
                      aria-label="Quantity"
                      className="text-right"
                      inputMode="numeric"
                      value={l.qty}
                      onChange={(e) => setLine(l.id, { qty: e.target.value.replace(/\D/g, '') })}
                    />
                    <Input
                      aria-label="Rate"
                      className="text-right"
                      inputMode="decimal"
                      value={l.rate}
                      onChange={(e) =>
                        setLine(l.id, { rate: e.target.value.replace(/[^\d.]/g, '') })
                      }
                    />
                    <Input
                      aria-label="Tax percent"
                      className="text-right"
                      inputMode="decimal"
                      value={l.taxPct}
                      onChange={(e) =>
                        setLine(l.id, { taxPct: e.target.value.replace(/[^\d.]/g, '') })
                      }
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="Remove line"
                      disabled={lines.length <= 1}
                      onClick={() => removeLine(l.id)}
                    >
                      <Trash2Icon className="size-4" aria-hidden />
                    </Button>
                  </div>
                ))}
              </div>
              <Button type="button" size="sm" variant="outline" onClick={addLine}>
                <PlusIcon className="mr-1.5 size-4" aria-hidden />
                Add line
              </Button>
            </div>

            {/* Terms / notes */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="inv-terms">Terms</Label>
                <Textarea
                  id="inv-terms"
                  rows={2}
                  value={terms}
                  placeholder="Net 30"
                  onChange={(e) => setTerms(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="inv-notes">Notes</Label>
                <Textarea
                  id="inv-notes"
                  rows={2}
                  value={notes}
                  placeholder="Thank you for your business."
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            {/* Totals */}
            <div className="bg-muted/30 ml-auto w-full max-w-xs space-y-1 rounded-md border p-3 text-sm">
              <Row label="Subtotal" value={formatINR(totals.subtotal)} />
              {intraState ? (
                <>
                  <Row label="CGST" value={formatINR(totals.cgst)} />
                  <Row label="SGST" value={formatINR(totals.sgst)} />
                </>
              ) : (
                <Row label="IGST" value={formatINR(totals.igst)} />
              )}
              <Row label="Total tax" value={formatINR(totals.taxTotal)} />
              <div className="mt-1 border-t pt-1 font-semibold">
                <Row label="Grand total" value={formatINR(totals.total)} />
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {stage === 'preview' ? (
            <>
              <Button variant="outline" onClick={() => setStage('edit')} disabled={busy !== null}>
                Back to edit
              </Button>
              <Button onClick={onSaveAndDownload} disabled={busy !== null}>
                <DownloadIcon className="mr-1.5 size-4" aria-hidden />
                {busy === 'finalize' ? 'Saving…' : 'Save & download'}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={busy !== null}
              >
                Cancel
              </Button>
              <Button onClick={onGeneratePreview} disabled={busy !== null}>
                <EyeIcon className="mr-1.5 size-4" aria-hidden />
                {busy === 'preview' ? 'Generating…' : 'Generate preview'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
