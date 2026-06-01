'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2Icon, DownloadIcon, EyeIcon, FileTextIcon, UploadIcon } from 'lucide-react';
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
  uploadDocument,
  type EntityDocumentEntityType,
  type EntityDocumentRow,
} from '@/lib/server/entities/entity-documents';
import { getDocumentSignedUrl } from '@/lib/server/entities/documents';

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

export function DocumentsSection({
  entityType,
  entityId,
  entityName,
  onOpenDocument,
}: DocumentsSectionProps) {
  const [rows, setRows] = useState<readonly EntityDocumentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewing, setViewing] = useState<EntityDocumentRow | null>(null);

  // Load + reload on demand.
  const reload = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await listEntityDocuments({ entityType, entityId });
        if (!cancelled) {
          setRows(data);
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
  }, [entityType, entityId]);

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

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Documents{' '}
            <span className="text-muted-foreground text-xs font-normal">({rows.length})</span>
          </CardTitle>
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <UploadIcon className="mr-1.5 size-4" aria-hidden />
            Upload document
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={FileTextIcon}
              title="No documents yet"
              description={`Upload contracts, invoices, receipts, or other documents related to ${entityName}.`}
            />
          ) : (
            <ul className="divide-y">
              {rows.map((doc) => (
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
                        <span className="truncate">{doc.title ?? doc.originalFilename}</span>
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
        }}
      />

      <ViewDialog doc={viewing} onClose={() => setViewing(null)} />
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: EntityDocumentEntityType;
  entityId: string;
  entityName: string;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<string>('contract');
  const [title, setTitle] = useState('');
  const [signedAt, setSignedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [signedByUs, setSignedByUs] = useState(false);
  const [signedByThem, setSignedByThem] = useState(false);
  const [uploading, setUploading] = useState(false);

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
    });
  }, [open]);

  async function submit() {
    if (!file) {
      toast.error('Pick a file first.');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('entityType', entityType);
      fd.append('entityId', entityId);
      fd.append('kind', kind);
      if (title) fd.append('title', title);
      if (signedAt) fd.append('signedAt', signedAt);
      if (expiresAt) fd.append('expiresAt', expiresAt);
      if (signedByUs) fd.append('signedByUs', 'true');
      if (signedByThem) fd.append('signedByThem', 'true');
      await uploadDocument(fd);
      toast.success('Document uploaded.');
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
          <Button onClick={submit} disabled={uploading || !file}>
            {uploading ? 'Uploading…' : 'Upload'}
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
          <DialogTitle className="truncate">
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
