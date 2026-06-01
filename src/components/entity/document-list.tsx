'use client';

import { useState } from 'react';
import {
  AlertCircleIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileTextIcon,
  FilterIcon,
  HistoryIcon,
  TrashIcon,
  UploadIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';

/**
 * Document kinds per AUDIT-GAPS §5 + amendment. Kept as an open union so
 * Backend can extend it without a Frontend deploy.
 */
export type DocumentKind =
  | 'contract'
  | 'msa'
  | 'sow'
  | 'offer_letter'
  | 'invoice'
  | 'po'
  | 'receipt'
  | 'kyc'
  | 'note'
  | 'other'
  | (string & {});

export type DocumentSignStatus =
  | 'unsigned'
  | 'pending_us'
  | 'pending_them'
  | 'signed'
  | 'expired'
  | (string & {});

export type EntityDocument = {
  id: string;
  /** Display name; usually the original filename. */
  name: string;
  kind: DocumentKind;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string | Date;
  uploadedBy?: string | null;
  signStatus?: DocumentSignStatus | null;
  signedAt?: string | Date | null;
  expiresAt?: string | Date | null;
  /**
   * Set when this document supersedes another (e.g. updated MSA replaces last
   * year's). UI hides older versions by default; "Show previous versions"
   * toggles them on.
   */
  supersedesId?: string | null;
  /**
   * Set when soft-deleted. The audit trail keeps the row but the UI greys it.
   */
  deletedAt?: string | Date | null;
};

const SIGN_TONES: Record<string, StatusTone> = {
  signed: 'success',
  pending_us: 'warning',
  pending_them: 'info',
  expired: 'danger',
  unsigned: 'neutral',
};

const SIGN_LABELS: Record<string, string> = {
  signed: 'Signed',
  pending_us: 'Awaiting us',
  pending_them: 'Awaiting them',
  expired: 'Expired',
  unsigned: 'Unsigned',
};

const KIND_LABELS: Record<string, string> = {
  contract: 'Contract',
  msa: 'MSA',
  sow: 'SOW',
  offer_letter: 'Offer letter',
  invoice: 'Invoice',
  po: 'PO',
  receipt: 'Receipt',
  kyc: 'KYC',
  note: 'Note',
  other: 'Other',
};

export type DocumentListProps = {
  documents: readonly EntityDocument[];
  entityName?: string;
  /** Click handler for a document row — typically opens the viewer in-place. */
  onOpen?: (document: EntityDocument) => void;
  /** Called when the user clicks "Upload". */
  onUpload?: () => void;
  /** Soft-delete callback. */
  onDelete?: (document: EntityDocument) => void;
  /** Download callback. Implementation returns a 5-minute signed URL. */
  onDownload?: (document: EntityDocument) => void;
  className?: string;
};

export function DocumentList({
  documents,
  entityName,
  onOpen,
  onUpload,
  onDelete,
  onDownload,
  className,
}: DocumentListProps) {
  const [kindFilter, setKindFilter] = useState<DocumentKind | 'all'>('all');
  const [showSuperseded, setShowSuperseded] = useState(false);

  const visible = documents.filter((doc) => {
    if (kindFilter !== 'all' && doc.kind !== kindFilter) return false;
    if (!showSuperseded && doc.supersedesId) return false;
    return true;
  });

  const knownKinds = Array.from(new Set(documents.map((d) => d.kind)));
  const hasSuperseded = documents.some((d) => d.supersedesId);

  if (documents.length === 0) {
    return (
      <EmptyState
        icon={FileTextIcon}
        title="No documents on file"
        description={`Drag & drop a contract, invoice or KYC document${
          entityName ? ` for ${entityName}` : ''
        } to attach it.`}
        action={
          <Button size="sm" onClick={onUpload} disabled={!onUpload}>
            <UploadIcon className="mr-1.5 size-3.5" aria-hidden />
            Upload document
          </Button>
        }
      />
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <CardTitle className="text-base">Documents</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {knownKinds.length > 1 ? (
            <div className="flex items-center gap-1.5 text-xs">
              <FilterIcon className="text-muted-foreground size-3.5" aria-hidden />
              <select
                className="bg-background h-8 rounded-md border px-2 text-xs"
                value={kindFilter}
                onChange={(e) => setKindFilter(e.target.value as DocumentKind | 'all')}
              >
                <option value="all">All kinds</option>
                {knownKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABELS[kind] ?? kind}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {hasSuperseded ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSuperseded((v) => !v)}
              className="gap-1.5"
            >
              <HistoryIcon className="size-3.5" aria-hidden />
              {showSuperseded ? 'Hide previous versions' : 'Show previous versions'}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={onUpload} disabled={!onUpload}>
            <UploadIcon className="mr-1.5 size-3.5" aria-hidden />
            Upload
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="px-4">Name</TableHead>
              <TableHead className="px-4">Kind</TableHead>
              <TableHead className="px-4">Status</TableHead>
              <TableHead className="px-4">Uploaded</TableHead>
              <TableHead className="px-4 text-right">Size</TableHead>
              <TableHead className="px-4 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((doc) => (
              <TableRow
                key={doc.id}
                className={cn(
                  doc.deletedAt && 'opacity-50',
                  doc.supersedesId && 'bg-muted/20',
                  onOpen && 'cursor-pointer',
                )}
                onClick={onOpen ? () => onOpen(doc) : undefined}
              >
                <TableCell className="px-4 font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <FileTextIcon className="size-3.5 opacity-60" aria-hidden />
                    {doc.name}
                    {doc.supersedesId ? (
                      <span className="text-muted-foreground text-xs">(older version)</span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground px-4">
                  {KIND_LABELS[doc.kind] ?? doc.kind}
                </TableCell>
                <TableCell className="px-4">
                  {doc.signStatus ? (
                    <StatusBadge
                      tone={SIGN_TONES[doc.signStatus] ?? 'neutral'}
                      label={SIGN_LABELS[doc.signStatus] ?? doc.signStatus}
                    />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                  {doc.expiresAt && doc.signStatus !== 'expired' ? (
                    <span className="text-muted-foreground ml-2 inline-flex items-center gap-1 text-xs">
                      <AlertCircleIcon className="size-3 opacity-60" aria-hidden />
                      expires {formatShortDate(doc.expiresAt)}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground px-4 text-xs">
                  {formatShortDate(doc.uploadedAt)}
                  {doc.uploadedBy ? <div className="mt-0.5 text-xs">{doc.uploadedBy}</div> : null}
                </TableCell>
                <TableCell className="text-muted-foreground px-4 text-right tabular-nums">
                  {formatBytes(doc.sizeBytes)}
                </TableCell>
                <TableCell className="px-4 text-right">
                  <div
                    className="inline-flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {onDownload ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDownload(doc)}
                        aria-label="Download document"
                      >
                        <DownloadIcon className="size-3.5" aria-hidden />
                      </Button>
                    ) : null}
                    {onDelete ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(doc)}
                        aria-label="Remove document"
                      >
                        <TrashIcon className="size-3.5" aria-hidden />
                      </Button>
                    ) : null}
                    {onOpen ? (
                      <ChevronRightIcon className="text-muted-foreground size-3.5" aria-hidden />
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatShortDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
