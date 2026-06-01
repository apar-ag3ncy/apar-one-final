'use client';

import { useEffect, useState } from 'react';
import { DownloadIcon, FileTextIcon, LoaderIcon, AlertCircleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { PdfJsViewer } from './pdfjs-viewer';

export type DocumentViewerProps = {
  /** Document id; consumer's `onResolveUrl` translates this into a 5-min URL. */
  documentId: string;
  /** Display name for header / aria-label. */
  name: string;
  /** MIME type — drives the viewer strategy. */
  mimeType: string;
  /**
   * Async resolver supplied by the consumer. Implementation calls a server
   * action that returns a 5-minute signed URL. The viewer caches the URL until
   * `documentId` changes; the parent must refetch if rotation is needed.
   */
  onResolveUrl: (documentId: string) => Promise<{ url: string; expiresAt: string }>;
  /** Optional download trigger (typically opens the same URL via window.open). */
  onDownload?: () => void;
  className?: string;
};

/**
 * Inline document viewer used in the entity profile and the extraction review
 * screen. Strategy by MIME:
 *
 *   - application/pdf → embedded <iframe> (server-side PDF.js or browser native)
 *   - image/* → native <img>
 *   - application/vnd.openxmlformats-officedocument.* (DOCX/XLSX) → "download only"
 *     CTA — we don't try to render Office docs inline.
 *   - everything else → file metadata + download CTA.
 *
 * The viewer never imports `@supabase/*`. URL resolution is the consumer's
 * job; this component only renders.
 */
export function DocumentViewer({
  documentId,
  name,
  mimeType,
  onResolveUrl,
  onDownload,
  className,
}: DocumentViewerProps) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; url: string; expiresAt: string }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    // TODO(human): replace with key={documentId} on the consumer so React
    // resets state on document switch; suppressing here because the consumer
    // count is small and resets always need to happen at fetch start.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ kind: 'loading' });
    onResolveUrl(documentId)
      .then((result) => {
        if (!cancelled) setState({ kind: 'ready', ...result });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: e instanceof Error ? e.message : 'Could not load document',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, onResolveUrl]);

  return (
    <div
      className={cn('bg-card flex h-full flex-col overflow-hidden rounded-md border', className)}
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileTextIcon className="size-4 shrink-0 opacity-70" aria-hidden />
          <span className="truncate text-sm font-medium">{name}</span>
        </div>
        {onDownload ? (
          <Button variant="ghost" size="sm" onClick={onDownload} aria-label="Download">
            <DownloadIcon className="size-3.5" aria-hidden />
          </Button>
        ) : null}
      </div>
      <div className="flex-1 overflow-auto">
        <ViewerBody state={state} mimeType={mimeType} name={name} onDownload={onDownload} />
      </div>
    </div>
  );
}

function ViewerBody({
  state,
  mimeType,
  name,
  onDownload,
}: {
  state:
    | { kind: 'loading' }
    | { kind: 'ready'; url: string; expiresAt: string }
    | { kind: 'error'; message: string };
  mimeType: string;
  name: string;
  onDownload?: () => void;
}) {
  if (state.kind === 'loading') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex w-full max-w-sm flex-col items-center gap-3">
          <LoaderIcon className="text-muted-foreground size-5 animate-spin" aria-hidden />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <AlertCircleIcon className="text-destructive size-5" aria-hidden />
          <p className="text-sm font-medium">Couldn&apos;t load document</p>
          <p className="text-muted-foreground text-xs">{state.message}</p>
        </div>
      </div>
    );
  }

  const { url } = state;

  if (mimeType === 'application/pdf') {
    return <PdfJsViewer url={url} />;
  }

  if (mimeType.startsWith('image/')) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <FileTextIcon className="text-muted-foreground size-8" aria-hidden />
        <div>
          <p className="text-sm font-medium">{name}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            {mimeType || 'Unknown type'} · preview not supported
          </p>
        </div>
        {onDownload ? (
          <Button size="sm" onClick={onDownload}>
            <DownloadIcon className="mr-1.5 size-3.5" aria-hidden />
            Download
          </Button>
        ) : (
          <Button asChild size="sm">
            <a href={url} target="_blank" rel="noopener noreferrer" download={name}>
              <DownloadIcon className="mr-1.5 size-3.5" aria-hidden />
              Download
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
