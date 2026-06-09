'use client';

import { useEffect, useMemo, useState } from 'react';
import { DownloadIcon, EyeIcon, LoaderIcon, PlusIcon, Trash2Icon } from 'lucide-react';
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
  updateDraftInvoice,
  type CreateInvoiceInput,
} from '@/lib/server/billing/invoices';
import { renderInvoicePreview } from '@/lib/server/billing/invoice-preview';
import { sendInvoice } from '@/lib/server/billing/invoice-transitions';
import { getDocumentSignedUrl } from '@/lib/server/entities/documents';
import type { InvoiceThemeSummary } from '@/lib/server/billing/invoice-themes';

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
/* Composer dialog                                                            */
/* -------------------------------------------------------------------------- */

export type InvoiceComposerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  /** Apār's own 2-digit state code; place-of-supply matching it ⇒ CGST+SGST. */
  supplierStateCode?: string;
  themes: InvoiceThemeSummary[];
  defaultThemeId?: string | null;
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
  themes,
  defaultThemeId,
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
  const [placeOfSupply, setPlaceOfSupply] = useState(supplierStateCode);
  const [terms, setTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [themeId, setThemeId] = useState<string>('');
  // Preserved across edits (no picker in this composer): a draft created with a
  // project keeps its association when re-saved here.
  const [projectId, setProjectId] = useState<string | null>(null);
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

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
            setPlaceOfSupply(invoice.placeOfSupply ?? supplierStateCode);
            setTerms(invoice.terms ?? '');
            setNotes(invoice.notes ?? '');
            setThemeId(invoice.themeId ?? '');
            setProjectId(invoice.projectId ?? null);
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
        setDocumentDate(TODAY_ISO());
        setDueDate('');
        setPlaceOfSupply(supplierStateCode);
        setTerms('');
        setNotes('');
        setThemeId(defaultThemeId ?? '');
        setProjectId(null);
        setLines([emptyLine()]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, existingInvoiceId, supplierStateCode, defaultThemeId]);

  // Revoke object URLs to avoid leaks.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const computed = useMemo(() => lines.map(computeLine), [lines]);
  const intraState = placeOfSupply.trim() === supplierStateCode.trim();

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
        ) : busy === 'preview' ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <LoaderIcon className="text-muted-foreground size-8 animate-spin" aria-hidden />
            <div className="text-sm font-medium">Generating preview…</div>
            <div className="text-muted-foreground max-w-xs text-xs">
              Rendering the invoice PDF. The first one can take up to ~20 seconds — please keep this
              window open.
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
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
                <Input
                  id="inv-pos"
                  inputMode="numeric"
                  maxLength={2}
                  placeholder="27"
                  value={placeOfSupply}
                  onChange={(e) => setPlaceOfSupply(e.target.value.replace(/\D/g, '').slice(0, 2))}
                />
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
              {totals.total <= 0n && busy === null ? (
                <span className="text-muted-foreground mr-auto self-center text-xs">
                  Add a line with a description and a rate to enable the preview.
                </span>
              ) : null}
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={busy !== null}
              >
                Cancel
              </Button>
              <Button onClick={onGeneratePreview} disabled={busy !== null || totals.total <= 0n}>
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
