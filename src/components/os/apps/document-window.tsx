'use client';

// Document-viewer window body — 800×1000 portrait per amendment §10.2.
// Multiple instances can be open simultaneously; each has its own
// `entityId = documentId`. The OS dispatcher routes
// `app='documents', entityId=<documentId>` to this body.
//
// Resolves the document's metadata + signed URL via the real server
// action (lib/server/entities/documents:getDocumentSignedUrl) on mount,
// then passes the right MIME to the inline viewer so it picks the
// strategy: PDF.js for PDFs, native <img> for images, download-only
// CTA for DOCX / XLSX.

import { useEffect, useState } from 'react';

import { DocumentViewer } from '@/components/entity/document-viewer';
import { resolveDocumentUrl } from '@/lib/os/data-providers';

export type DocumentWindowProps = {
  documentId: string;
  /** Optional pre-known name; skips the first metadata round trip. */
  name?: string;
  /** Optional pre-known MIME; skips the first metadata round trip. */
  mimeType?: string;
};

export function DocumentWindow({
  documentId,
  name: nameProp,
  mimeType: mimeProp,
}: DocumentWindowProps) {
  const [meta, setMeta] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; name: string; mimeType: string }
    | { kind: 'error'; message: string }
  >(
    nameProp && mimeProp
      ? { kind: 'ready', name: nameProp, mimeType: mimeProp }
      : { kind: 'loading' },
  );

  useEffect(() => {
    if (nameProp && mimeProp) return;
    let cancelled = false;
    resolveDocumentUrl(documentId)
      .then((res) => {
        if (!cancelled) setMeta({ kind: 'ready', name: res.name, mimeType: res.mimeType });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setMeta({
          kind: 'error',
          message: e instanceof Error ? e.message : 'Failed to resolve document',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, nameProp, mimeProp]);

  if (meta.kind === 'loading') {
    return (
      <div className="main" style={{ padding: 24 }}>
        <p style={{ color: 'var(--text-muted)' }}>Resolving document…</p>
      </div>
    );
  }
  if (meta.kind === 'error') {
    return (
      <div className="main" style={{ padding: 24 }}>
        <p style={{ color: 'var(--text-error, #c33)' }}>{meta.message}</p>
      </div>
    );
  }

  return (
    <div className="main" style={{ display: 'flex', flex: 1, padding: 16 }}>
      <DocumentViewer
        documentId={documentId}
        name={meta.name}
        mimeType={meta.mimeType}
        onResolveUrl={resolveDocumentUrl}
      />
    </div>
  );
}
