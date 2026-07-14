'use client';

import { useEffect, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DateField } from '@/components/shared/date-field';
import { rupeesToPaise } from '@/lib/money';
import { todayIstIso } from '@/lib/billing/fy';
import { uploadDocument } from '@/lib/server/entities/entity-documents';
import { listProjectOptionsForClient, type EntityOption } from '@/lib/server/entities/options';
import { recordUploadedClientInvoice } from '@/lib/server/billing/record-uploaded-invoice';
import type { ClientBillingReadiness } from '@/lib/server/billing/invoices';

const NO_PROJECT = '__none__';
/** Far below the int8 ceiling — a typo guard mirrored server-side. */
const MAX_AMOUNT_PAISE = 10_000_000_000_000_000n; // ₹100,000 crore

/** "1,180.50" → paise; empty → 0n; negative, over-cap or invalid → null. */
function parseRupeesOrNull(value: string): bigint | null {
  const raw = value.replace(/,/g, '').trim();
  if (raw === '') return 0n;
  try {
    const paise = rupeesToPaise(raw);
    return paise < 0n || paise > MAX_AMOUNT_PAISE ? null : paise;
  } catch {
    return null;
  }
}

/** Non-negative by construction (parseRupeesOrNull rejects negatives). */
function formatPaiseAsRupees(paise: bigint): string {
  const whole = paise / 100n;
  const frac = paise % 100n;
  return frac === 0n ? String(whole) : `${whole}.${frac.toString().padStart(2, '0')}`;
}

export type UploadInvoiceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  /** Billing readiness — recording needs GSTIN + PAN + address (GST strict). */
  readiness: ClientBillingReadiness | null;
  /**
   * When set, record this ALREADY-UPLOADED document instead of asking for a
   * new file — used by the "Record in books" action on a pending upload.
   */
  existingDocumentId?: string | null;
  /** Label of the existing document, shown in place of the file picker. */
  existingLabel?: string | null;
  /** Called after a successful record OR a plain upload, to refresh the tab. */
  onDone: () => void;
};

/**
 * Upload an invoice PDF straight from the Invoices tab (or record an invoice
 * PDF that was already uploaded to the Documents tab) as a real, counted
 * invoice. Mirrors the Documents-tab "record in books" capture, but lives
 * where the founder looks for invoices.
 *
 * GST stays strict: a client without GSTIN + PAN + address can't have an
 * invoice posted to the books. In that case a NEW file still uploads (as an
 * `invoice`-kind document) so it SHOWS in the Invoices tab as "not in books",
 * and can be recorded later once the client is billing-ready.
 */
export function UploadInvoiceDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
  readiness,
  existingDocumentId,
  existingLabel,
  onDone,
}: UploadInvoiceDialogProps) {
  const recordingExisting = Boolean(existingDocumentId);
  const ready = readiness?.ready ?? false;
  const missing = readiness?.missing ?? [];

  const [file, setFile] = useState<File | null>(null);
  const [projectOptions, setProjectOptions] = useState<readonly EntityOption[]>([]);
  const [number, setNumber] = useState('');
  const [date, setDate] = useState(todayIstIso());
  const [dueDate, setDueDate] = useState('');
  const [projectId, setProjectId] = useState<string>(NO_PROJECT);
  const [subtotal, setSubtotal] = useState('');
  const [cgst, setCgst] = useState('');
  const [sgst, setSgst] = useState('');
  const [igst, setIgst] = useState('');
  const [total, setTotal] = useState('');
  const [totalTouched, setTotalTouched] = useState(false);
  // Keep an uploaded doc id if recording fails after upload, so a retry
  // re-records against the same file (server idempotency keys off this id).
  const [uploadedDocId, setUploadedDocId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset on open. Deferred so the lint doesn't see a synchronous setState
  // chain inside the effect body.
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setFile(null);
      setNumber('');
      setDate(todayIstIso());
      setDueDate('');
      setProjectId(NO_PROJECT);
      setSubtotal('');
      setCgst('');
      setSgst('');
      setIgst('');
      setTotal('');
      setTotalTouched(false);
      setUploadedDocId(null);
    });
  }, [open]);

  // Load this client's projects for the attribution dropdown.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listProjectOptionsForClient(clientId)
      .then((opts) => {
        if (!cancelled) setProjectOptions(opts);
      })
      .catch(() => {
        if (!cancelled) setProjectOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, clientId]);

  /** Keep the Total suggestion in sync until the user edits it directly. */
  function suggestTotal(sub: string, c: string, s: string, i: string) {
    if (totalTouched) return;
    const parts = [sub, c, s, i].map(parseRupeesOrNull);
    if (parts.some((p) => p === null)) return;
    const sum = (parts as bigint[]).reduce((a, b) => a + b, 0n);
    setTotal(sum === 0n ? '' : formatPaiseAsRupees(sum));
  }

  function validateAmounts() {
    const n = number.trim();
    if (!n) {
      toast.error('Enter the invoice number printed on the document.');
      return null;
    }
    if (n.length > 60) {
      toast.error('Invoice number must be 60 characters or fewer.');
      return null;
    }
    if (!date) {
      toast.error('Pick the invoice date.');
      return null;
    }
    const subtotalPaise = parseRupeesOrNull(subtotal);
    const cgstPaise = parseRupeesOrNull(cgst);
    const sgstPaise = parseRupeesOrNull(sgst);
    const igstPaise = parseRupeesOrNull(igst);
    const totalPaise = parseRupeesOrNull(total);
    if (
      subtotalPaise === null ||
      cgstPaise === null ||
      sgstPaise === null ||
      igstPaise === null ||
      totalPaise === null
    ) {
      toast.error('Amounts must be positive numbers with up to 2 decimals.');
      return null;
    }
    if (subtotalPaise <= 0n) {
      toast.error('Enter the subtotal (before GST) printed on the invoice.');
      return null;
    }
    if (totalPaise !== subtotalPaise + cgstPaise + sgstPaise + igstPaise) {
      toast.error('Total must equal Subtotal + CGST + SGST + IGST. Match the printed invoice.');
      return null;
    }
    return { subtotalPaise, cgstPaise, sgstPaise, igstPaise, totalPaise };
  }

  async function record(
    documentId: string,
    amounts: NonNullable<ReturnType<typeof validateAmounts>>,
  ) {
    const result = await recordUploadedClientInvoice({
      clientId,
      projectId: projectId === NO_PROJECT ? null : projectId,
      uploadedDocumentId: documentId,
      documentNumber: number.trim(),
      documentDate: date,
      dueDate: dueDate || null,
      subtotalPaise: amounts.subtotalPaise,
      cgstPaise: amounts.cgstPaise,
      sgstPaise: amounts.sgstPaise,
      igstPaise: amounts.igstPaise,
      capturedTotalPaise: amounts.totalPaise,
    });
    if (result.ok) {
      toast.success(
        result.alreadyRecorded
          ? `Invoice ${result.documentNumber} was already recorded.`
          : `Invoice ${result.documentNumber} recorded in the books.`,
      );
      onDone();
      onOpenChange(false);
      return true;
    }
    // Keep the doc id so a retry re-records without a duplicate upload.
    setUploadedDocId(documentId);
    toast.error(result.message);
    return false;
  }

  async function submit() {
    if (busy) return;

    // Recording an already-uploaded pending document.
    if (recordingExisting) {
      if (!ready) {
        toast.error(`Add this client's ${missing.join(', ')} before recording it in the books.`);
        return;
      }
      const amounts = validateAmounts();
      if (!amounts) return;
      setBusy(true);
      try {
        await record(existingDocumentId as string, amounts);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not record the invoice.');
      } finally {
        setBusy(false);
      }
      return;
    }

    // New upload path.
    if (!file && !uploadedDocId) {
      toast.error('Pick the invoice PDF first.');
      return;
    }
    // Validate amounts BEFORE uploading when we intend to record — a bad form
    // never leaves a document without its invoice.
    const amounts = ready ? validateAmounts() : null;
    if (ready && !amounts) return;

    setBusy(true);
    try {
      let documentId = uploadedDocId;
      if (!documentId) {
        const fd = new FormData();
        fd.append('file', file!);
        fd.append('entityType', 'client');
        fd.append('entityId', clientId);
        fd.append('kind', 'invoice');
        if (number.trim()) fd.append('title', `Invoice ${number.trim()}`);
        ({ documentId } = await uploadDocument(fd));
      }
      if (ready && amounts) {
        try {
          const done = await record(documentId, amounts);
          if (!done) return; // record() already toasted + kept the doc id
        } catch (e) {
          setUploadedDocId(documentId);
          toast.error(
            e instanceof Error
              ? e.message
              : 'Uploaded, but recording failed — retry from this dialog.',
          );
        }
        return;
      }
      // Not billing-ready: the file is uploaded and now shows in the tab as
      // "not in books"; it can be recorded once the client's details are set.
      toast.success('Invoice uploaded — record it in the books once this client has GSTIN & PAN.');
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  const showCapture = ready; // GST strict: only ready clients capture + post.

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {recordingExisting ? 'Record uploaded invoice' : 'Upload invoice'}
          </DialogTitle>
          <DialogDescription>
            For {clientName}.{' '}
            {showCapture
              ? 'The amounts are captured off the paper and posted to the books.'
              : 'It will be added to the Invoices tab; record it in the books once this client has GSTIN, PAN and an address.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {recordingExisting ? (
            <p className="text-muted-foreground rounded-md border px-3 py-2 text-xs">
              Recording <strong>{existingLabel || 'the uploaded file'}</strong>. Enter the amounts
              printed on it.
            </p>
          ) : uploadedDocId ? (
            <p className="text-muted-foreground rounded-md border px-3 py-2 text-xs">
              {file?.name ?? 'The file'} is already uploaded. Fix the details and retry — or Cancel
              to keep it as an uploaded document.
            </p>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="upinv-file">Invoice PDF</Label>
              <Input
                id="upinv-file"
                type="file"
                accept=".pdf,image/*,.docx,.xlsx,.txt,.csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={busy}
              />
            </div>
          )}

          {!ready && !recordingExisting ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              {missing.length > 0 ? (
                <>
                  Add <strong>{clientName}</strong>&apos;s <strong>{missing.join(', ')}</strong> to
                  record this in the books. For now it will just be filed under Invoices.
                </>
              ) : (
                'This invoice will be filed under Invoices; add it to the books once ready.'
              )}
            </div>
          ) : null}

          {showCapture ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="upinv-number">Invoice number</Label>
                  <Input
                    id="upinv-number"
                    className="font-mono"
                    placeholder="INV/2026-27/0042"
                    maxLength={60}
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="upinv-project">Project</Label>
                  <Select value={projectId} onValueChange={setProjectId} disabled={busy}>
                    <SelectTrigger id="upinv-project">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PROJECT}>— No project —</SelectItem>
                      {projectOptions.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="upinv-date">Invoice date</Label>
                  <DateField
                    id="upinv-date"
                    value={date}
                    onChange={(n) => setDate(n)}
                    disabled={busy}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="upinv-due">Due date (optional)</Label>
                  <DateField
                    id="upinv-due"
                    value={dueDate}
                    onChange={(n) => setDueDate(n)}
                    disabled={busy}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="upinv-subtotal">Subtotal ₹ (before GST)</Label>
                  <Input
                    id="upinv-subtotal"
                    inputMode="decimal"
                    placeholder="100000"
                    value={subtotal}
                    onChange={(e) => {
                      setSubtotal(e.target.value);
                      suggestTotal(e.target.value, cgst, sgst, igst);
                    }}
                    disabled={busy}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="upinv-total">Total ₹ (as printed)</Label>
                  <Input
                    id="upinv-total"
                    inputMode="decimal"
                    placeholder="118000"
                    value={total}
                    onChange={(e) => {
                      setTotalTouched(e.target.value.trim() !== '');
                      setTotal(e.target.value);
                    }}
                    disabled={busy}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="upinv-cgst">CGST ₹</Label>
                  <Input
                    id="upinv-cgst"
                    inputMode="decimal"
                    placeholder="0"
                    value={cgst}
                    onChange={(e) => {
                      setCgst(e.target.value);
                      suggestTotal(subtotal, e.target.value, sgst, igst);
                    }}
                    disabled={busy}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="upinv-sgst">SGST ₹</Label>
                  <Input
                    id="upinv-sgst"
                    inputMode="decimal"
                    placeholder="0"
                    value={sgst}
                    onChange={(e) => {
                      setSgst(e.target.value);
                      suggestTotal(subtotal, cgst, e.target.value, igst);
                    }}
                    disabled={busy}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="upinv-igst">IGST ₹</Label>
                  <Input
                    id="upinv-igst"
                    inputMode="decimal"
                    placeholder="0"
                    value={igst}
                    onChange={(e) => {
                      setIgst(e.target.value);
                      suggestTotal(subtotal, cgst, sgst, e.target.value);
                    }}
                    disabled={busy}
                  />
                </div>
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy
              ? 'Working…'
              : recordingExisting
                ? 'Record invoice'
                : ready
                  ? 'Upload & record'
                  : 'Upload'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
