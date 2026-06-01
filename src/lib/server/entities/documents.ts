'use server';

import { eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { documents } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { getSignedDocumentUrl } from '@/lib/storage';
import { getActorContext } from '@/lib/server/actor';

/**
 * Server-action wrapper around `lib/storage.ts:getSignedDocumentUrl` for
 * the OS document window + the Dashboard DocumentViewer. Resolves a
 * `documents.id` to a 5-minute signed URL.
 *
 * KYC reveals go through `revealKyc` / `revealBank` instead — that's why
 * we refuse the `restricted-kyc` bucket here.
 *
 * Returns `{ url, expiresAt, mimeType, name }` so the viewer doesn't need
 * a second round-trip for metadata.
 */
export async function getDocumentSignedUrl(documentId: string): Promise<{
  url: string;
  expiresAt: string;
  mimeType: string;
  name: string;
  sizeBytes: number;
}> {
  const ctx = await getActorContext();

  const rows = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  const doc = rows[0];
  if (!doc) {
    throw new AppError('not_found', `Document ${documentId} not found`);
  }
  if (doc.bucket === 'restricted-kyc') {
    throw new AppError(
      'kyc.reveal_capability',
      'KYC documents must be revealed via revealKyc — capability-gated and audit-logged.',
    );
  }

  const signed = await getSignedDocumentUrl(ctx, {
    bucket: doc.bucket,
    objectKey: doc.storagePath,
    entityType: doc.entityType,
    entityId: doc.entityId,
  });

  return {
    url: signed.signedUrl,
    expiresAt: signed.expiresAt,
    mimeType: doc.mimeType,
    name: doc.originalFilename,
    sizeBytes: doc.sizeBytes,
  };
}
