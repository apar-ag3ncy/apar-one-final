'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  DownloadIcon,
  EyeIcon,
  FileTextIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { StatusBadge } from '@/components/shared/status-badge';
import { CopyButton } from '@/components/shared/copy-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { notify } from '@/lib/client/toast';
import {
  deleteCompanyDocument,
  updateCompanyDocumentMeta,
  updateCompanyProfile,
  uploadCompanyDocument,
} from '@/lib/server/settings/company';
import type {
  CompanyDocumentCategory,
  CompanyDocumentRow,
  CompanyProfile,
} from '@/lib/server/settings/company-data';

const CATEGORY_LABELS: Record<CompanyDocumentCategory, string> = {
  gst: 'GST certificate',
  tan: 'TAN',
  pan: 'PAN',
  udyam: 'Udyam (MSME)',
  incorporation: 'Incorporation',
  partnership_deed: 'Partnership deed',
  rent_agreement: 'Office rent agreement',
  other: 'Other',
};

const CATEGORY_ORDER: CompanyDocumentCategory[] = [
  'gst',
  'tan',
  'pan',
  'udyam',
  'incorporation',
  'partnership_deed',
  'rent_agreement',
  'other',
];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Dashboard wrapper — server component passes props; refresh re-runs the page query. */
export function CompanySettingsClient({
  profile,
  documents,
}: {
  profile: CompanyProfile;
  documents: readonly CompanyDocumentRow[];
}) {
  const router = useRouter();
  return <CompanySettingsBody profile={profile} documents={documents} onChanged={router.refresh} />;
}

/**
 * Shared body — also embedded by the OS Settings → Company documents pane,
 * which fetches the data client-side and passes its own refetch as `onChanged`.
 */
export function CompanySettingsBody({
  profile,
  documents,
  onChanged,
}: {
  profile: CompanyProfile;
  documents: readonly CompanyDocumentRow[];
  onChanged: () => void;
}) {
  return (
    <div className="space-y-6">
      <ProfileCard profile={profile} onChanged={onChanged} />
      <DocumentsCard documents={documents} onChanged={onChanged} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                    */
/* -------------------------------------------------------------------------- */

type ProfileForm = {
  legalName: string;
  displayName: string;
  gstin: string;
  pan: string;
  tan: string;
  udyam: string;
  registeredAddress: string;
  secondaryAddress: string;
};

function toForm(p: CompanyProfile): ProfileForm {
  return {
    legalName: p.legalName ?? '',
    displayName: p.displayName ?? '',
    gstin: p.gstin ?? '',
    pan: p.pan ?? '',
    tan: p.tan ?? '',
    udyam: p.udyam ?? '',
    registeredAddress: p.registeredAddress ?? '',
    secondaryAddress: p.secondaryAddress ?? '',
  };
}

function ProfileCard({ profile, onChanged }: { profile: CompanyProfile; onChanged: () => void }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProfileForm>(() => toForm(profile));

  function set<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startEdit() {
    setForm(toForm(profile));
    setEditing(true);
  }

  function save() {
    startTransition(async () => {
      const result = await updateCompanyProfile({
        legalName: form.legalName,
        displayName: form.displayName,
        gstin: form.gstin || null,
        pan: form.pan || null,
        tan: form.tan || null,
        udyam: form.udyam || null,
        registeredAddress: form.registeredAddress || null,
        secondaryAddress: form.secondaryAddress || null,
      });
      if (result.ok) {
        notify.success('Company details saved');
        setEditing(false);
        onChanged();
      } else {
        notify.error('Could not save', result.message);
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <CardTitle className="text-base">Company profile</CardTitle>
        {editing ? (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={pending}>
              Save
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={startEdit}>
            <PencilIcon className="mr-1 size-3.5" aria-hidden />
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="grid gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FieldInput
                label="Legal name"
                value={form.legalName}
                onChange={(v) => set('legalName', v)}
              />
              <FieldInput
                label="Display name"
                value={form.displayName}
                onChange={(v) => set('displayName', v)}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FieldInput
                label="GSTIN"
                value={form.gstin}
                mono
                onChange={(v) => set('gstin', v.toUpperCase())}
                placeholder="27ABCDE1234F1Z5"
              />
              <FieldInput
                label="PAN"
                value={form.pan}
                mono
                onChange={(v) => set('pan', v.toUpperCase())}
                placeholder="ABCDE1234F"
              />
              <FieldInput
                label="TAN"
                value={form.tan}
                mono
                onChange={(v) => set('tan', v.toUpperCase())}
                placeholder="ABCD12345E"
              />
              <FieldInput
                label="Udyam / MSME"
                value={form.udyam}
                mono
                onChange={(v) => set('udyam', v.toUpperCase())}
                placeholder="UDYAM-MH-00-0000000"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FieldTextarea
                label="Primary (registered) address"
                value={form.registeredAddress}
                onChange={(v) => set('registeredAddress', v)}
              />
              <FieldTextarea
                label="Secondary address"
                value={form.secondaryAddress}
                onChange={(v) => set('secondaryAddress', v)}
                optional
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-5">
            <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
              <ReadField label="Legal name" value={profile.legalName} />
              <ReadField label="Display name" value={profile.displayName} />
              <ReadField label="GSTIN" value={profile.gstin} mono copyLabel="GSTIN" />
              <ReadField label="PAN" value={profile.pan} mono copyLabel="PAN" />
              <ReadField label="TAN" value={profile.tan} mono copyLabel="TAN" />
              <ReadField label="Udyam / MSME" value={profile.udyam} mono copyLabel="Udyam" />
            </div>
            <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
              <ReadAddress
                label="Primary (registered) address"
                value={profile.registeredAddress}
                copyLabel="primary address"
              />
              <ReadAddress
                label="Secondary address"
                value={profile.secondaryAddress}
                copyLabel="secondary address"
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReadField({
  label,
  value,
  mono,
  copyLabel,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  copyLabel?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-xs">{label}</div>
      {value ? (
        <div className="flex items-center gap-1">
          <span className={mono ? 'font-mono text-sm' : 'text-sm'}>{value}</span>
          <CopyButton value={value} label={copyLabel ?? label} />
        </div>
      ) : (
        <div className="text-muted-foreground/60 text-sm">Not set</div>
      )}
    </div>
  );
}

function ReadAddress({
  label,
  value,
  copyLabel,
}: {
  label: string;
  value: string | null;
  copyLabel: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground text-xs">{label}</span>
        {value ? <CopyButton value={value} label={copyLabel} /> : null}
      </div>
      {value ? (
        <p className="text-sm whitespace-pre-line">{value}</p>
      ) : (
        <div className="text-muted-foreground/60 text-sm">Not set</div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                  */
/* -------------------------------------------------------------------------- */

function DocumentsCard({
  documents,
  onChanged,
}: {
  documents: readonly CompanyDocumentRow[];
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CompanyDocumentRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CompanyDocumentRow | null>(null);

  function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    startTransition(async () => {
      const result = await deleteCompanyDocument(id);
      if (result.ok) {
        notify.success('Document removed');
        onChanged();
      } else {
        notify.error('Could not remove', result.message);
      }
    });
  }

  const sorted = [...documents].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <CardTitle className="text-base">Documents</CardTitle>
        <Button size="sm" onClick={() => setUploadOpen(true)}>
          <PlusIcon className="mr-1 size-4" aria-hidden />
          Upload
        </Button>
      </CardHeader>
      <CardContent className={documents.length === 0 ? '' : 'p-0'}>
        {documents.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center text-sm">
            No documents yet. Upload your GST/PAN/TAN certificates, partnership deed, rent
            agreements, or any other company document — and record its number while you do.
          </div>
        ) : (
          <ul className="divide-y">
            {sorted.map((doc) => (
              <li
                key={doc.id}
                className="flex flex-col gap-3 px-6 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <FileTextIcon
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                    aria-hidden
                  />
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{doc.title}</span>
                      <StatusBadge tone="neutral" label={CATEGORY_LABELS[doc.category]} />
                    </div>
                    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                      <span className="truncate">{doc.originalFilename}</span>
                      <span>{formatBytes(doc.sizeBytes)}</span>
                    </div>
                    {doc.referenceNumber ? (
                      <div className="flex items-center gap-1 text-sm">
                        <span className="text-muted-foreground text-xs">No.</span>
                        <span className="font-mono">{doc.referenceNumber}</span>
                        <CopyButton value={doc.referenceNumber} label="number" />
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button asChild variant="ghost" size="sm">
                    <a
                      href={`/settings/company/documents/${doc.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <EyeIcon className="mr-1 size-3.5" aria-hidden />
                      View
                    </a>
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <a href={`/settings/company/documents/${doc.id}?download=1`}>
                      <DownloadIcon className="mr-1 size-3.5" aria-hidden />
                      Download
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => setEditTarget(doc)}
                    aria-label="Edit document details"
                  >
                    <PencilIcon className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive size-8"
                    onClick={() => setDeleteTarget(doc)}
                    aria-label="Remove document"
                  >
                    <Trash2Icon className="size-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onUploaded={onChanged} />
      <EditMetaDialog doc={editTarget} onClose={() => setEditTarget(null)} onSaved={onChanged} />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              The document is removed from this list. This can&apos;t be undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function UploadDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [category, setCategory] = useState<CompanyDocumentCategory>('gst');
  const [title, setTitle] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setCategory('gst');
    setTitle('');
    setReferenceNumber('');
    setNotes('');
    if (fileRef.current) fileRef.current.value = '';
  }

  function submit() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      notify.error('Choose a file', 'Pick a PDF or image to upload.');
      return;
    }
    // Mirror the server's 25 MB cap client-side: gives instant feedback and
    // keeps the request under the Server Action body limit, so an oversized
    // file fails with a clear message instead of crashing the upload silently.
    const MAX_DOC_BYTES = 25 * 1024 * 1024;
    if (file.size > MAX_DOC_BYTES) {
      notify.error(
        'File too large',
        `Documents must be 25 MB or smaller — this one is ${(file.size / 1024 / 1024).toFixed(1)} MB.`,
      );
      return;
    }
    if (!title.trim()) {
      notify.error('Add a title', 'Give the document a short title.');
      return;
    }
    const fd = new FormData();
    fd.set('file', file);
    fd.set('category', category);
    fd.set('title', title.trim());
    fd.set('referenceNumber', referenceNumber.trim());
    fd.set('notes', notes.trim());
    startTransition(async () => {
      try {
        const result = await uploadCompanyDocument(fd);
        if (result.ok) {
          notify.success('Document uploaded');
          reset();
          onOpenChange(false);
          onUploaded();
        } else {
          notify.error('Upload failed', result.message);
        }
      } catch (e) {
        // A throw here (e.g. the request exceeded the transport body limit, or
        // a network error) would otherwise bubble to the error boundary and
        // close the dialog with no explanation. Surface it as a toast instead.
        notify.error(
          'Upload failed',
          e instanceof Error ? e.message : 'Something went wrong while uploading.',
        );
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>
            Attach a certificate, deed, or agreement — and record its number manually while you
            upload.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Type</Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as CompanyDocumentCategory)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_ORDER.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-title" className="text-xs">
              Title
            </Label>
            <Input
              id="doc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. GST registration certificate"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-ref" className="text-xs">
              Number / reference <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="doc-ref"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              className="font-mono"
              placeholder="e.g. the GSTIN / agreement number"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-notes" className="text-xs">
              Notes <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="doc-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-file" className="text-xs">
              File
            </Label>
            <Input id="doc-file" ref={fileRef} type="file" className="cursor-pointer" />
            <p className="text-muted-foreground text-xs">
              PDF, image, or Office document up to 25 MB.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            <UploadIcon className="mr-1 size-4" aria-hidden />
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditMetaDialog({
  doc,
  onClose,
  onSaved,
}: {
  doc: CompanyDocumentRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  // Sync local state when a new doc is opened.
  if (doc && hydratedFor !== doc.id) {
    setHydratedFor(doc.id);
    setTitle(doc.title);
    setReferenceNumber(doc.referenceNumber ?? '');
    setNotes(doc.notes ?? '');
  }

  function save() {
    if (!doc) return;
    if (!title.trim()) {
      notify.error('Add a title');
      return;
    }
    startTransition(async () => {
      const result = await updateCompanyDocumentMeta(doc.id, {
        title: title.trim(),
        referenceNumber: referenceNumber.trim() || null,
        notes: notes.trim() || null,
      });
      if (result.ok) {
        notify.success('Document updated');
        onClose();
        onSaved();
      } else {
        notify.error('Could not save', result.message);
      }
    });
  }

  return (
    <Dialog
      open={doc !== null}
      onOpenChange={(o) => {
        if (!o) {
          setHydratedFor(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit document details</DialogTitle>
          <DialogDescription>
            Update the title, recorded number, or notes. To replace the file, upload a new document.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-title" className="text-xs">
              Title
            </Label>
            <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-ref" className="text-xs">
              Number / reference <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="edit-ref"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-notes" className="text-xs">
              Notes <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="edit-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Small field helpers                                                        */
/* -------------------------------------------------------------------------- */

function FieldInput({
  label,
  value,
  onChange,
  mono,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={mono ? 'font-mono' : undefined}
        placeholder={placeholder}
      />
    </div>
  );
}

function FieldTextarea({
  label,
  value,
  onChange,
  optional,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
        {optional ? <span className="text-muted-foreground"> (optional)</span> : null}
      </Label>
      <Textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
