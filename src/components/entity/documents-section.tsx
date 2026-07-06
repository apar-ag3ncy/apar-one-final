'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2Icon,
  DownloadIcon,
  EyeIcon,
  FileTextIcon,
  RotateCcwIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusBadge } from '@/components/shared/status-badge';
import { DocumentViewer } from '@/components/entity/document-viewer';
import {
  listEntityDocuments,
  listTrashedDocuments,
  permanentlyDeleteDocument,
  restoreDocument,
  softDeleteDocument,
  uploadDocument,
  type EntityDocumentEntityType,
  type EntityDocumentRow,
} from '@/lib/server/entities/entity-documents';
import { getDocumentSignedUrl } from '@/lib/server/entities/documents';
import { useCurrentUser } from '@/lib/client/use-current-user';
import { useEntityMutation } from '@/components/os/auth/entity-mutation-gate';
import { rupeesToPaise } from '@/lib/money';
import { todayIstIso } from '@/lib/billing/fy';
import {
  getClientBillingReadiness,
  type ClientBillingReadiness,
} from '@/lib/server/billing/invoices';
import { recordUploadedClientInvoice } from '@/lib/server/billing/record-uploaded-invoice';
import { listProjectOptionsForClient, type EntityOption } from '@/lib/server/entities/options';

export type DocumentsSectionProps = {
  entityType: EntityDocumentEntityType;
  entityId: string;
  entityName: string;
  /**
   * Optional click handler for opening a document in an external surface
   * (e.g. OS window). When provided, the section calls this instead of
   * showing the inline ViewDialog. Dashboard leaves this undefined to
   * keep the in-page preview behavior; OS Windows pass a handler that
   * dispatches `osActions.openWindow({ app: 'documents', entityId })`.
   */
  onOpenDocument?: (documentId: string) => void;
  /**
   * Fired after a successful upload, once the section has reloaded its
   * own list. Parents pass this to refetch entity-level counts (e.g. the
   * KPI tile or tab badge that reads `client.documentsCount`).
   */
  onUploaded?: () => void;
};

const KIND_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'contract', label: 'Contract' },
  { value: 'msa', label: 'MSA' },
  { value: 'sow', label: 'SOW' },
  { value: 'nda', label: 'NDA' },
  { value: 'offer_letter', label: 'Offer letter' },
  { value: 'separation_letter', label: 'Separation letter' },
  { value: 'payslip', label: 'Payslip' },
  { value: 'salary_sheet', label: 'Salary sheet' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'receipt', label: 'Receipt' },
  { value: 'cancelled_cheque', label: 'Cancelled cheque' },
  { value: 'bank_statement', label: 'Bank statement' },
  { value: 'expense_receipt', label: 'Expense receipt' },
  { value: 'reimbursement_receipt', label: 'Reimbursement receipt' },
  { value: 'photo', label: 'Photo' },
  { value: 'other', label: 'Other' },
];

const KIND_LABEL = new Map<string, string>(KIND_OPTIONS.map((k) => [k.value, k.label]));

/** Radix Select forbids an empty-string item value — sentinel for "no project". */
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
  return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(2, '0')}`;
}

export function DocumentsSection({
  entityType,
  entityId,
  entityName,
  onOpenDocument,
  onUploaded,
}: DocumentsSectionProps) {
  const [rows, setRows] = useState<readonly EntityDocumentRow[] | null>(null);
  const [trashRows, setTrashRows] = useState<readonly EntityDocumentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewing, setViewing] = useState<EntityDocumentRow | null>(null);
  const [mode, setMode] = useState<'active' | 'trash'>('active');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<EntityDocumentRow | null>(null);

  // OS read-only bridge — permissive outside the OS. Upload needs the edit
  // grant; the trash actions (delete / restore / permanent-delete) need delete.
  const { canEdit, canDelete } = useEntityMutation();

  // Load + reload on demand. Trash is only fetched when the user can delete.
  const reload = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [active, trashed] = await Promise.all([
          listEntityDocuments({ entityType, entityId }),
          canDelete
            ? listTrashedDocuments({ entityType, entityId })
            : Promise.resolve([] as EntityDocumentRow[]),
        ]);
        if (!cancelled) {
          setRows(active);
          setTrashRows(trashed);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load documents');
      }
    }
    reload.current = load;
    void load();
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId, canDelete]);

  async function moveToTrash(doc: EntityDocumentRow) {
    if (busyId) return;
    setBusyId(doc.id);
    try {
      await softDeleteDocument(doc.id);
      toast.success(`Moved "${doc.title ?? doc.originalFilename}" to Trash.`);
      await reload.current();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete document');
    } finally {
      setBusyId(null);
    }
  }
  async function restore(doc: EntityDocumentRow) {
    if (busyId) return;
    setBusyId(doc.id);
    try {
      await restoreDocument(doc.id);
      toast.success(`Restored "${doc.title ?? doc.originalFilename}".`);
      await reload.current();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not restore document');
    } finally {
      setBusyId(null);
    }
  }
  async function permanentlyDelete(doc: EntityDocumentRow) {
    if (busyId) return;
    setBusyId(doc.id);
    try {
      await permanentlyDeleteDocument(doc.id);
      toast.success(`Permanently deleted "${doc.title ?? doc.originalFilename}".`);
      setConfirming(null);
      await reload.current();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not permanently delete');
    } finally {
      setBusyId(null);
    }
  }

  if (error) {
    return <EmptyState icon={FileTextIcon} title="Could not load documents" description={error} />;
  }
  if (rows === null) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-full max-w-[160px]" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const list = mode === 'trash' ? trashRows : rows;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            {mode === 'trash' ? 'Trash' : 'Documents'}{' '}
            <span className="text-muted-foreground text-xs font-normal">({list.length})</span>
          </CardTitle>
          <div className="flex items-center gap-2">
            {canDelete ? (
              mode === 'trash' ? (
                <Button size="sm" variant="outline" onClick={() => setMode('active')}>
                  Back to documents
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setMode('trash')}>
                  <Trash2Icon className="mr-1.5 size-4" aria-hidden />
                  Trash{trashRows.length > 0 ? ` (${trashRows.length})` : ''}
                </Button>
              )
            ) : null}
            {mode === 'active' && canEdit ? (
              <Button size="sm" onClick={() => setUploadOpen(true)}>
                <UploadIcon className="mr-1.5 size-4" aria-hidden />
                Upload document
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {list.length === 0 ? (
            <EmptyState
              icon={mode === 'trash' ? Trash2Icon : FileTextIcon}
              title={mode === 'trash' ? 'Trash is empty' : 'No documents yet'}
              description={
                mode === 'trash'
                  ? 'Deleted documents land here. Restore them, or delete them permanently.'
                  : `Upload contracts, invoices, receipts, or other documents related to ${entityName}.`
              }
            />
          ) : (
            <ul className="divide-y">
              {list.map((doc) => (
                <li
                  key={doc.id}
                  className="hover:bg-muted/30 flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <FileTextIcon
                      className="text-muted-foreground mt-0.5 size-4 shrink-0"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                          {doc.title ?? doc.originalFilename}
                        </span>
                        {doc.version > 1 ? (
                          <StatusBadge tone="info" label={`v${doc.version}`} dot={false} />
                        ) : null}
                        {doc.signedByUs || doc.signedByThem ? (
                          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                            <CheckCircle2Icon className="size-3" aria-hidden />
                            Signed
                          </span>
                        ) : null}
                      </div>
                      <div className="text-muted-foreground mt-0.5 text-xs">
                        {KIND_LABEL.get(doc.kind) ?? doc.kind}
                        {' · '}
                        {prettySize(doc.sizeBytes)}
                        {' · '}
                        {new Date(doc.createdAt).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {mode === 'active' ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (onOpenDocument) {
                              onOpenDocument(doc.documentId);
                            } else {
                              setViewing(doc);
                            }
                          }}
                          aria-label="View document"
                        >
                          <EyeIcon className="size-4" aria-hidden />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void downloadDocument(doc)}
                          aria-label="Download document"
                        >
                          <DownloadIcon className="size-4" aria-hidden />
                        </Button>
                        {canDelete ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void moveToTrash(doc)}
                            disabled={busyId === doc.id}
                            aria-label="Move to Trash"
                            title="Move to Trash"
                          >
                            <Trash2Icon className="size-4" aria-hidden />
                          </Button>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={() => void restore(doc)}
                          disabled={busyId === doc.id}
                        >
                          <RotateCcwIcon className="mr-1.5 size-3.5" aria-hidden />
                          Restore
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setConfirming(doc)}
                          disabled={busyId === doc.id}
                          aria-label="Delete permanently"
                          title="Delete permanently"
                        >
                          <Trash2Icon className="size-4" aria-hidden />
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        entityType={entityType}
        entityId={entityId}
        entityName={entityName}
        onUploaded={() => {
          setUploadOpen(false);
          void reload.current();
          onUploaded?.();
        }}
        onDocumentAdded={() => {
          void reload.current();
          onUploaded?.();
        }}
      />

      <ViewDialog doc={viewing} onClose={() => setViewing(null)} />

      <Dialog
        open={confirming !== null}
        onOpenChange={(v) => {
          // Don't let Escape / overlay-click dismiss the dialog mid-delete —
          // the operation would finish in the background and the user would
          // think it was cancelled.
          if (!v && busyId === null) setConfirming(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete permanently?</DialogTitle>
            <DialogDescription>
              &ldquo;{confirming?.title ?? confirming?.originalFilename}&rdquo; will be deleted for
              good — the file is removed from storage and cannot be recovered. If it&apos;s attached
              to a recorded bill or invoice, that copy is kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={busyId !== null}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirming && void permanentlyDelete(confirming)}
              disabled={busyId !== null}
            >
              {busyId ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Upload dialog                                                              */
/* -------------------------------------------------------------------------- */

function UploadDialog({
  open,
  onOpenChange,
  entityType,
  entityId,
  entityName,
  onUploaded,
  onDocumentAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: EntityDocumentEntityType;
  entityId: string;
  entityName: string;
  /** Upload finished (and record step, if any, succeeded) — close + refresh. */
  onUploaded: () => void;
  /** Document uploaded but the dialog stays open (record step failed) — refresh only. */
  onDocumentAdded?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<string>('contract');
  const [title, setTitle] = useState('');
  const [signedAt, setSignedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [signedByUs, setSignedByUs] = useState(false);
  const [signedByThem, setSignedByThem] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Invoice-in-books capture — client documents of kind 'invoice' can be
  // recorded as a real invoice (ledger posting, AR, project income).
  const { hasCapability, isLoading: userLoading } = useCurrentUser();
  const canRecordInvoice =
    entityType === 'client' &&
    hasCapability('create_invoice') &&
    hasCapability('send_invoice') &&
    hasCapability('post_transaction');
  const invoiceMode = kind === 'invoice' && canRecordInvoice;
  const [recordInBooks, setRecordInBooks] = useState(true);
  const [readiness, setReadiness] = useState<ClientBillingReadiness | 'loading' | 'error'>(
    'loading',
  );
  const [readinessAttempt, setReadinessAttempt] = useState(0);
  const [projectOptions, setProjectOptions] = useState<readonly EntityOption[]>([]);
  const [invNumber, setInvNumber] = useState('');
  const [invDate, setInvDate] = useState('');
  const [invDueDate, setInvDueDate] = useState('');
  const [invProjectId, setInvProjectId] = useState<string>(NO_PROJECT);
  const [invSubtotal, setInvSubtotal] = useState('');
  const [invCgst, setInvCgst] = useState('');
  const [invSgst, setInvSgst] = useState('');
  const [invIgst, setInvIgst] = useState('');
  const [invTotal, setInvTotal] = useState('');
  const [invTotalTouched, setInvTotalTouched] = useState(false);
  // After a successful upload whose record step failed, the document id is
  // kept so a retry re-records WITHOUT re-uploading a duplicate file (the
  // server's idempotency key is derived from this id).
  const [uploadedDocId, setUploadedDocId] = useState<string | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const ready = typeof readiness === 'object' && readiness.ready;
  const notReady = typeof readiness === 'object' && !readiness.ready;
  const recording = invoiceMode && recordInBooks && ready;

  // Reset state when dialog opens. Defer via microtask so the lint doesn't
  // see a synchronous setState chain inside the effect body.
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setFile(null);
      setKind('contract');
      setTitle('');
      setSignedAt('');
      setExpiresAt('');
      setSignedByUs(false);
      setSignedByThem(false);
      setRecordInBooks(true);
      setReadiness('loading');
      setProjectOptions([]);
      setInvNumber('');
      setInvDate(todayIstIso());
      setInvDueDate('');
      setInvProjectId(NO_PROJECT);
      setInvSubtotal('');
      setInvCgst('');
      setInvSgst('');
      setInvIgst('');
      setInvTotal('');
      setInvTotalTouched(false);
      setUploadedDocId(null);
      setRecordError(null);
    });
  }, [open]);

  // Billing readiness + this client's projects, loaded when the user picks
  // kind 'invoice' on a client document. `readinessAttempt` re-runs it from
  // the Retry affordance after a failed fetch.
  useEffect(() => {
    if (!open || !invoiceMode) return;
    let cancelled = false;
    getClientBillingReadiness(entityId)
      .then((r) => {
        if (!cancelled) setReadiness(r);
      })
      .catch(() => {
        if (!cancelled) setReadiness('error');
      });
    listProjectOptionsForClient(entityId)
      .then((opts) => {
        if (!cancelled) setProjectOptions(opts);
      })
      .catch(() => {
        if (!cancelled) setProjectOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, invoiceMode, entityId, readinessAttempt]);

  /** Keep the Total suggestion in sync until the user edits it directly. */
  function suggestTotal(sub: string, cgst: string, sgst: string, igst: string) {
    if (invTotalTouched) return;
    const parts = [sub, cgst, sgst, igst].map(parseRupeesOrNull);
    if (parts.some((p) => p === null)) return;
    const sum = (parts as bigint[]).reduce((a, b) => a + b, 0n);
    setInvTotal(sum === 0n ? '' : formatPaiseAsRupees(sum));
  }

  async function submit() {
    if (!file && !uploadedDocId) {
      toast.error('Pick a file first.');
      return;
    }
    if (entityType === 'client' && kind === 'invoice' && userLoading) {
      toast.error('Still checking your permissions — try again in a moment.');
      return;
    }
    if (invoiceMode && recordInBooks && readiness === 'loading') {
      toast.error('Still checking the client’s billing readiness — try again in a moment.');
      return;
    }
    if (invoiceMode && recordInBooks && readiness === 'error') {
      toast.error(
        'Could not check the client’s billing readiness — use Retry, or uncheck "Record in books".',
      );
      return;
    }
    // Validate the invoice capture BEFORE uploading anything, so a bad form
    // never leaves a document without its invoice.
    let invoiceAmounts: {
      subtotalPaise: bigint;
      cgstPaise: bigint;
      sgstPaise: bigint;
      igstPaise: bigint;
      totalPaise: bigint;
    } | null = null;
    if (recording) {
      const number = invNumber.trim();
      if (!number) {
        toast.error('Enter the invoice number printed on the document.');
        return;
      }
      if (number.length > 60) {
        toast.error('Invoice number must be 60 characters or fewer.');
        return;
      }
      if (!invDate) {
        toast.error('Pick the invoice date.');
        return;
      }
      const subtotalPaise = parseRupeesOrNull(invSubtotal);
      const cgstPaise = parseRupeesOrNull(invCgst);
      const sgstPaise = parseRupeesOrNull(invSgst);
      const igstPaise = parseRupeesOrNull(invIgst);
      const totalPaise = parseRupeesOrNull(invTotal);
      if (
        subtotalPaise === null ||
        cgstPaise === null ||
        sgstPaise === null ||
        igstPaise === null ||
        totalPaise === null
      ) {
        toast.error('Amounts must be positive numbers with up to 2 decimals.');
        return;
      }
      if (subtotalPaise <= 0n) {
        toast.error('Enter the subtotal (before GST) printed on the invoice.');
        return;
      }
      if (totalPaise !== subtotalPaise + cgstPaise + sgstPaise + igstPaise) {
        toast.error(
          'Total must equal Subtotal + CGST + SGST + IGST. Adjust the amounts to match the printed invoice.',
        );
        return;
      }
      invoiceAmounts = { subtotalPaise, cgstPaise, sgstPaise, igstPaise, totalPaise };
    }
    setUploading(true);
    setRecordError(null);
    try {
      let documentId = uploadedDocId;
      if (!documentId) {
        const fd = new FormData();
        fd.append('file', file!);
        fd.append('entityType', entityType);
        fd.append('entityId', entityId);
        fd.append('kind', kind);
        if (title) fd.append('title', title);
        if (signedAt) fd.append('signedAt', signedAt);
        if (expiresAt) fd.append('expiresAt', expiresAt);
        if (signedByUs) fd.append('signedByUs', 'true');
        if (signedByThem) fd.append('signedByThem', 'true');
        ({ documentId } = await uploadDocument(fd));
      }
      if (recording && invoiceAmounts) {
        // The record step gets its own failure domain: the document is
        // already uploaded, so a failure keeps the dialog open with the
        // typed details intact and retries against the SAME document.
        let failureMessage: string | null = null;
        try {
          const result = await recordUploadedClientInvoice({
            clientId: entityId,
            projectId: invProjectId === NO_PROJECT ? null : invProjectId,
            uploadedDocumentId: documentId,
            documentNumber: invNumber.trim(),
            documentDate: invDate,
            dueDate: invDueDate || null,
            description: title.trim().slice(0, 1000) || null,
            subtotalPaise: invoiceAmounts.subtotalPaise,
            cgstPaise: invoiceAmounts.cgstPaise,
            sgstPaise: invoiceAmounts.sgstPaise,
            igstPaise: invoiceAmounts.igstPaise,
            capturedTotalPaise: invoiceAmounts.totalPaise,
          });
          if (result.ok) {
            toast.success(
              result.alreadyRecorded
                ? `Invoice ${result.documentNumber} was already recorded in the books.`
                : `Invoice ${result.documentNumber} recorded in the books.`,
            );
            onUploaded();
            return;
          }
          failureMessage = result.message;
        } catch {
          failureMessage =
            'Network or server error while recording — it may or may not have landed. Retry, or check the client’s Invoices tab.';
        }
        setUploadedDocId(documentId);
        setRecordError(failureMessage);
        toast.error(`Document uploaded, but the invoice was not recorded.`);
        onDocumentAdded?.();
        return;
      }
      toast.success(uploadedDocId ? 'Document kept as a plain upload.' : 'Document uploaded.');
      onUploaded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>
            For {entityName}. Max 25 MB. Magic-byte sniff rejects mismatched MIME. KYC documents
            (PAN, Aadhaar, etc.) must use the KYC flow instead.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {uploadedDocId ? (
            <p className="text-muted-foreground rounded-md border px-3 py-2 text-xs">
              {file?.name ?? 'The file'} is already uploaded. Fix the invoice details below and
              press Record invoice — or Cancel to keep it as a plain document.
            </p>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="doc-file">File</Label>
              <Input
                id="doc-file"
                type="file"
                accept=".pdf,image/*,.docx,.xlsx,.txt,.csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={uploading}
              />
              {file ? (
                <p className="text-muted-foreground text-xs">
                  {file.name} · {prettySize(file.size)} · {file.type || 'unknown type'}
                </p>
              ) : null}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="doc-kind">Kind</Label>
              <Select value={kind} onValueChange={setKind} disabled={uploading}>
                <SelectTrigger id="doc-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="doc-title">Title (optional)</Label>
              <Input
                id="doc-title"
                placeholder="MSA v2 — Apar × Lodha"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={uploading}
              />
            </div>
          </div>

          {invoiceMode ? (
            <div className="grid gap-3 rounded-md border p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  checked={recordInBooks && !notReady && readiness !== 'error'}
                  onCheckedChange={(v) => setRecordInBooks(v === true)}
                  disabled={uploading || notReady || readiness === 'error'}
                />
                Record in books as a client invoice
              </label>
              {readiness === 'error' ? (
                <p className="text-muted-foreground text-xs">
                  Could not check the client&apos;s billing readiness.{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      setReadiness('loading');
                      setReadinessAttempt((n) => n + 1);
                    }}
                  >
                    Retry
                  </button>{' '}
                  — or upload as a plain document.
                </p>
              ) : notReady ? (
                <p className="text-muted-foreground text-xs">
                  To record this in the books, first add the client&apos;s{' '}
                  {readiness.missing.join(', ')}. The file will still upload as a plain document.
                </p>
              ) : recordInBooks ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="inv-doc-number">Invoice number</Label>
                      <Input
                        id="inv-doc-number"
                        className="font-mono"
                        placeholder="INV/2026-27/0042"
                        maxLength={60}
                        value={invNumber}
                        onChange={(e) => setInvNumber(e.target.value)}
                        disabled={uploading}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="inv-doc-project">Project</Label>
                      <Select
                        value={invProjectId}
                        onValueChange={setInvProjectId}
                        disabled={uploading}
                      >
                        <SelectTrigger id="inv-doc-project">
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
                      <Label htmlFor="inv-doc-date">Invoice date</Label>
                      <Input
                        id="inv-doc-date"
                        type="date"
                        value={invDate}
                        onChange={(e) => setInvDate(e.target.value)}
                        disabled={uploading}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="inv-doc-due">Due date (optional)</Label>
                      <Input
                        id="inv-doc-due"
                        type="date"
                        value={invDueDate}
                        onChange={(e) => setInvDueDate(e.target.value)}
                        disabled={uploading}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="inv-doc-subtotal">Subtotal ₹ (before GST)</Label>
                      <Input
                        id="inv-doc-subtotal"
                        inputMode="decimal"
                        placeholder="100000"
                        value={invSubtotal}
                        onChange={(e) => {
                          setInvSubtotal(e.target.value);
                          suggestTotal(e.target.value, invCgst, invSgst, invIgst);
                        }}
                        disabled={uploading}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="inv-doc-total">Total ₹ (as printed)</Label>
                      <Input
                        id="inv-doc-total"
                        inputMode="decimal"
                        placeholder="118000"
                        value={invTotal}
                        onChange={(e) => {
                          // Clearing the field hands control back to the
                          // auto-suggestion; typing takes it over.
                          if (e.target.value.trim() === '') {
                            setInvTotalTouched(false);
                            const parts = [invSubtotal, invCgst, invSgst, invIgst].map(
                              parseRupeesOrNull,
                            );
                            if (parts.some((p) => p === null)) {
                              setInvTotal('');
                            } else {
                              const sum = (parts as bigint[]).reduce((a, b) => a + b, 0n);
                              setInvTotal(sum === 0n ? '' : formatPaiseAsRupees(sum));
                            }
                          } else {
                            setInvTotal(e.target.value);
                            setInvTotalTouched(true);
                          }
                        }}
                        disabled={uploading}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="inv-doc-cgst">CGST ₹</Label>
                      <Input
                        id="inv-doc-cgst"
                        inputMode="decimal"
                        placeholder="0"
                        value={invCgst}
                        onChange={(e) => {
                          setInvCgst(e.target.value);
                          suggestTotal(invSubtotal, e.target.value, invSgst, invIgst);
                        }}
                        disabled={uploading}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="inv-doc-sgst">SGST ₹</Label>
                      <Input
                        id="inv-doc-sgst"
                        inputMode="decimal"
                        placeholder="0"
                        value={invSgst}
                        onChange={(e) => {
                          setInvSgst(e.target.value);
                          suggestTotal(invSubtotal, invCgst, e.target.value, invIgst);
                        }}
                        disabled={uploading}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="inv-doc-igst">IGST ₹</Label>
                      <Input
                        id="inv-doc-igst"
                        inputMode="decimal"
                        placeholder="0"
                        value={invIgst}
                        onChange={(e) => {
                          setInvIgst(e.target.value);
                          suggestTotal(invSubtotal, invCgst, invSgst, e.target.value);
                        }}
                        disabled={uploading}
                      />
                    </div>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Amounts in rupees, exactly as printed on the invoice. Recording posts it to the
                    ledger, so it shows in AR aging, P&amp;L and the assigned project&apos;s income.
                  </p>
                  {recordError ? (
                    <p className="text-destructive text-xs" role="alert">
                      {recordError}
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="doc-signed-at">Signed on</Label>
              <Input
                id="doc-signed-at"
                type="date"
                value={signedAt}
                onChange={(e) => setSignedAt(e.target.value)}
                disabled={uploading}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="doc-expires-at">Expires on</Label>
              <Input
                id="doc-expires-at"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                disabled={uploading}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={signedByUs}
                onCheckedChange={(v) => setSignedByUs(v === true)}
                disabled={uploading}
              />
              Signed by us
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={signedByThem}
                onCheckedChange={(v) => setSignedByThem(v === true)}
                disabled={uploading}
              />
              Signed by counterparty
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={uploading || (!file && !uploadedDocId)}>
            {uploading ? 'Working…' : uploadedDocId ? 'Record invoice' : 'Upload'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* View dialog                                                                */
/* -------------------------------------------------------------------------- */

function ViewDialog({ doc, onClose }: { doc: EntityDocumentRow | null; onClose: () => void }) {
  return (
    <Dialog open={doc !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="h-[80vh] max-w-4xl">
        <DialogHeader>
          <DialogTitle className="break-words [overflow-wrap:anywhere]">
            {doc?.title ?? doc?.originalFilename ?? 'Document'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {doc ? `${KIND_LABEL.get(doc.kind) ?? doc.kind} · ${doc.mimeType}` : ''}
          </DialogDescription>
        </DialogHeader>
        {doc ? (
          <div className="h-full flex-1 overflow-hidden rounded-md border">
            <DocumentViewer
              documentId={doc.documentId}
              name={doc.title ?? doc.originalFilename}
              mimeType={doc.mimeType}
              onResolveUrl={async (id) => {
                const r = await getDocumentSignedUrl(id);
                return { url: r.url, expiresAt: r.expiresAt };
              }}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function downloadDocument(doc: EntityDocumentRow) {
  try {
    const { url } = await getDocumentSignedUrl(doc.documentId);
    // Open in a new tab; browser will follow Content-Disposition (set on the
    // stored object) or render based on MIME. For an explicit download we'd
    // need a separate signed URL with `download:true`.
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not get download URL');
  }
}
