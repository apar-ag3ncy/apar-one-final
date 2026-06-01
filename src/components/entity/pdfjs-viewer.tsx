'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, LoaderIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Inline PDF.js viewer per SPEC-AMENDMENT-001 §10.1. Renders one page at
 * a time onto a `<canvas>` so we don't fight with iframe sandboxing or
 * browser-native quirks across the contracts / invoices / payslips
 * Apār touches.
 *
 * The pdfjs-dist worker is loaded from a same-version CDN — we don't
 * want to ship a worker file in the public/ tree (rebuild every dep
 * bump). If sandbox / offline support becomes a constraint, copy
 * `pdfjs-dist/build/pdf.worker.min.mjs` into public/ and replace
 * `WORKER_SRC` with `/pdf.worker.min.mjs`.
 */

type PdfDocumentProxy = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPageProxy>;
};

type PdfPageProxy = {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
};

type PdfJsLib = {
  version: string;
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: string | { url: string }) => { promise: Promise<PdfDocumentProxy> };
};

async function loadPdfJs(): Promise<PdfJsLib> {
  // Dynamic import so the heavy pdf.js bundle is only fetched when a PDF
  // actually needs to render. `pdfjs-dist` exposes the main API on the
  // package's default ESM export under newer versions.
  const mod = await import('pdfjs-dist');
  const lib = mod as unknown as PdfJsLib;
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${lib.version}/build/pdf.worker.min.mjs`;
  }
  return lib;
}

export type PdfJsViewerProps = {
  url: string;
  /** Initial zoom (1 = fit width). */
  scale?: number;
  className?: string;
};

export function PdfJsViewer({ url, scale = 1.2, className }: PdfJsViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PdfDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load the document once per URL. The reset writes run inside the effect
  // body — pdfjs's dynamic import is async so we set state on the next tick
  // via queueMicrotask to avoid the cascading-render lint.
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      setDoc(null);
      setPageNum(1);
    });

    loadPdfJs()
      .then((lib) => lib.getDocument({ url }).promise)
      .then((d) => {
        if (!cancelled) {
          setDoc(d);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load PDF');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  // Render the active page whenever it changes.
  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    let cancelled = false;
    const canvas = canvasRef.current;

    doc.getPage(pageNum).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const task = page.render({ canvasContext: ctx, viewport });
      task.promise.catch(() => {
        // Render aborts when component unmounts; ignore.
      });
    });

    return () => {
      cancelled = true;
    };
  }, [doc, pageNum, scale]);

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="text-muted-foreground text-xs">
          {loading ? 'Loading…' : error ? 'Error' : doc ? `Page ${pageNum} of ${doc.numPages}` : ''}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={!doc || pageNum <= 1}
            onClick={() => setPageNum((n) => Math.max(1, n - 1))}
            aria-label="Previous page"
          >
            <ChevronLeftIcon className="size-4" aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!doc || pageNum >= doc.numPages}
            onClick={() => setPageNum((n) => (doc ? Math.min(doc.numPages, n + 1) : n))}
            aria-label="Next page"
          >
            <ChevronRightIcon className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-neutral-200 dark:bg-neutral-900">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <LoaderIcon className="text-muted-foreground size-5 animate-spin" aria-hidden />
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <div className="text-destructive text-sm">{error}</div>
          </div>
        ) : (
          <div className="flex justify-center p-4">
            <canvas ref={canvasRef} className="bg-white shadow" />
          </div>
        )}
      </div>
    </div>
  );
}
