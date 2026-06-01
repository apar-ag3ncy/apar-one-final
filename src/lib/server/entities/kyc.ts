'use server';

import { z } from 'zod';

import { db } from '@/lib/db/client';
import { documents, entityDocuments } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { sniffMime } from '@/lib/storage';
import { createAdminClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/activity';
import { logAudit } from '@/lib/audit';
import { getActorContext } from '@/lib/server/actor';

/**
 * KYC document upload (CLAUDE rules #26–#28, DPDP Act 2023).
 *
 * The general `uploadDocument` (entity-documents.ts) deliberately REFUSES
 * `kyc_*` kinds so identity scans never land in the non-KYC buckets. This
 * action is the gated counterpart: KYC scans (PAN card, Aadhaar, passport,
 * voter id, driving license, cancelled cheque, bank statement) go to the
 * `restricted-kyc` bucket ONLY, with an audit row on every write.
 *
 * Note the asymmetry: UPLOAD requires `upload_document` (HR / managers who
 * create employees hold it), while REVEAL requires the stronger `reveal_kyc`
 * (`lib/storage.ts:revealKyc`, 60s signed URL + audit). You can file a scan
 * without being able to read it back — that's intentional.
 *
 * Full PAN/Aadhaar numbers are never stored in clear on a row; the scan in
 * `restricted-kyc` is the encrypted blob, and the principal row carries the
 * masked value only.
 */

const KYC_BUCKET = 'restricted-kyc' as const;
const MAX_BYTES = 25 * 1024 * 1024;

const KycEntityType = z.enum(['client', 'vendor', 'employee', 'project']);

const KycKind = z.enum([
  'kyc_pan',
  'kyc_aadhaar',
  'kyc_passport',
  'kyc_voter_id',
  'kyc_driving_license',
  'cancelled_cheque',
  'bank_statement',
]);

function safeFilename(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
}

export async function uploadKycDocument(formData: FormData): Promise<{
  documentId: string;
  entityDocumentId: string;
}> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'upload_document', 'Missing capability to file a KYC document.');

  const file = formData.get('file');
  if (!(file instanceof File)) {
    throw new AppError('validation', 'Missing or invalid file in upload payload.');
  }
  if (file.size === 0) {
    throw new AppError('validation', 'File is empty.');
  }
  if (file.size > MAX_BYTES) {
    throw new AppError(
      'storage.size_exceeded',
      `File exceeds ${Math.round(MAX_BYTES / 1024 / 1024)} MB limit.`,
    );
  }

  const entityType = KycEntityType.parse(formData.get('entityType'));
  const entityId = z.string().uuid().parse(formData.get('entityId'));
  const kind = KycKind.parse(formData.get('kind'));
  const title = (formData.get('title') as string | null) ?? null;
  const description = (formData.get('description') as string | null) ?? null;
  const expiresAtRaw = formData.get('expiresAt');
  const expiresAt =
    typeof expiresAtRaw === 'string' && expiresAtRaw.length > 0 ? expiresAtRaw : null;

  // Magic-byte sniff — never trust the browser's declared MIME alone.
  const headerBytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const detectedMime = sniffMime(headerBytes, file.type || undefined);
  const effectiveMime = file.type || detectedMime;

  const safeName = safeFilename(file.name);
  const objectKey = `${entityType}/${entityId}/${crypto.randomUUID()}-${safeName}`;

  const admin = createAdminClient();
  const fileBuffer = new Uint8Array(await file.arrayBuffer());
  const { error: uploadError } = await admin.storage
    .from(KYC_BUCKET)
    .upload(objectKey, fileBuffer, {
      contentType: effectiveMime,
      cacheControl: '60',
      upsert: false,
    });
  if (uploadError) {
    throw new AppError('internal', `KYC storage upload failed: ${uploadError.message}`);
  }

  const result = await db.transaction(async (tx) => {
    const [docRow] = await tx
      .insert(documents)
      .values({
        entityType,
        entityId,
        bucket: KYC_BUCKET,
        storagePath: objectKey,
        visibility: 'kyc',
        category: kind,
        originalFilename: file.name,
        mimeType: effectiveMime,
        sizeBytes: file.size,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: documents.id });
    if (!docRow) throw new AppError('internal', 'documents insert returned no row');

    const [edRow] = await tx
      .insert(entityDocuments)
      .values({
        entityType,
        entityId,
        documentId: docRow.id,
        kind,
        title,
        description,
        expiresAt,
        version: 1,
        status: 'active',
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: entityDocuments.id });
    if (!edRow) throw new AppError('internal', 'entity_documents insert returned no row');

    return { documentId: docRow.id, entityDocumentId: edRow.id, objectKey };
  });

  // KYC writes are audited (CLAUDE rule #27) even though they are not reveals.
  await logAudit({
    actorId: ctx.userId,
    entityType,
    entityId,
    action: 'upload_kyc',
    changes: { object_key: result.objectKey, document_kind: kind },
  });
  await logActivity({
    entityType,
    entityId,
    actorId: ctx.userId,
    kind: 'document.uploaded',
    summary: `Filed KYC document (${kind.replace(/_/g, ' ')})`,
    payload: { documentId: result.documentId, kind, bucket: KYC_BUCKET },
  });

  return { documentId: result.documentId, entityDocumentId: result.entityDocumentId };
}
