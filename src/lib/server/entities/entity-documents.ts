'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { documents, entityDocuments, transactions, users } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { sniffMime } from '@/lib/storage';
import { createAdminClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/activity';
import { getActorContext } from '@/lib/server/actor';

const MAX_BYTES_DEFAULT = 25 * 1024 * 1024; // SPEC-AMENDMENT-001 §10.3 — 25 MB default

const DocumentEntityType = z.enum(['client', 'vendor', 'employee', 'project']);

const DocumentKind = z.enum([
  'contract',
  'msa',
  'sow',
  'nda',
  'offer_letter',
  'separation_letter',
  'kyc_pan',
  'kyc_aadhaar',
  'kyc_passport',
  'kyc_voter_id',
  'kyc_driving_license',
  'cancelled_cheque',
  'bank_statement',
  'invoice',
  'receipt',
  'payslip',
  'salary_sheet',
  'reimbursement_receipt',
  'expense_receipt',
  'photo',
  'other',
]);

const DocumentVisibility = z.enum(['public', 'internal', 'restricted', 'kyc']);

const ENTITY_DETAIL_BASE: Record<z.infer<typeof DocumentEntityType>, string> = {
  client: '/clients',
  vendor: '/vendors',
  employee: '/employees',
  project: '/projects',
};

function revalidateEntityDetail(
  entityType: z.infer<typeof DocumentEntityType>,
  entityId: string,
): void {
  revalidatePath(`${ENTITY_DETAIL_BASE[entityType]}/${entityId}`);
}

/**
 * Maps a document kind to its target storage bucket. KYC kinds MUST land
 * in `restricted-kyc` and reveal via `revealKyc` only — this upload action
 * REFUSES them so the upload path stays out of the KYC vault.
 */
function bucketForKind(kind: z.infer<typeof DocumentKind>): {
  bucket: 'public-docs' | 'internal-docs' | 'restricted-docs';
  visibility: 'public' | 'internal' | 'restricted';
} {
  // Public-facing documents (e.g. case studies, marketing PDFs).
  if (kind === 'photo' || kind === 'other') {
    return { bucket: 'internal-docs', visibility: 'internal' };
  }
  // Everything else is at least restricted — contracts, invoices, receipts,
  // payslips, salary sheets, bank statements all carry PII or financials.
  return { bucket: 'restricted-docs', visibility: 'restricted' };
}

function safeFilename(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
}

/**
 * Upload a document for a principal entity. SPEC-AMENDMENT-001 §10.3.
 *
 * Pipeline:
 *   1. Read FormData (file + entityType + entityId + kind + optional title /
 *      signedAt / expiresAt).
 *   2. Validate size against MAX_BYTES_DEFAULT.
 *   3. Magic-byte sniff first 16 bytes; reject mismatch with the browser's
 *      declared MIME.
 *   4. KYC kinds are refused — they must go through the gated KYC flow.
 *   5. Upload to Supabase Storage via the service-role client.
 *   6. Insert `documents` (storage-ref) + `entity_documents` (typed link)
 *      in a transaction.
 *   7. Write an activity log entry.
 *
 * Returns `{ documentId, entityDocumentId, signedUrlExpiresAt }`.
 */
export async function uploadDocument(formData: FormData): Promise<{
  documentId: string;
  entityDocumentId: string;
}> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'upload_document');

  const file = formData.get('file');
  if (!(file instanceof File)) {
    throw new AppError('validation', 'Missing or invalid file in upload payload.');
  }
  if (file.size === 0) {
    throw new AppError('validation', 'File is empty.');
  }
  if (file.size > MAX_BYTES_DEFAULT) {
    throw new AppError(
      'storage.size_exceeded',
      `File exceeds ${Math.round(MAX_BYTES_DEFAULT / 1024 / 1024)} MB limit.`,
    );
  }

  const entityType = DocumentEntityType.parse(formData.get('entityType'));
  const entityId = z.string().uuid().parse(formData.get('entityId'));
  const kind = DocumentKind.parse(formData.get('kind'));
  const title = (formData.get('title') as string | null) ?? null;
  const description = (formData.get('description') as string | null) ?? null;
  const signedAtRaw = formData.get('signedAt');
  const expiresAtRaw = formData.get('expiresAt');
  const signedAt = typeof signedAtRaw === 'string' && signedAtRaw.length > 0 ? signedAtRaw : null;
  const expiresAt =
    typeof expiresAtRaw === 'string' && expiresAtRaw.length > 0 ? expiresAtRaw : null;
  const signedByUs = formData.get('signedByUs') === 'true';
  const signedByThem = formData.get('signedByThem') === 'true';

  // KYC kinds belong on the gated KYC path — refuse here.
  if (kind.startsWith('kyc_')) {
    throw new AppError(
      'kyc.reveal_capability',
      'KYC documents must be uploaded via the KYC flow (capability: reveal_kyc).',
    );
  }

  // Magic-byte sniff. `sniffMime` throws on mismatch.
  const headerBytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const detectedMime = sniffMime(headerBytes, file.type || undefined);
  // Use the detected MIME for storage Content-Type so downloads come back
  // with the right header.
  // Use the sniffed (true) type — detectedMime already falls back to the
  // browser-declared type when the bytes aren't recognized.
  const effectiveMime = detectedMime;

  const { bucket, visibility } = bucketForKind(kind);
  const safeName = safeFilename(file.name);
  const objectKey = `${entityType}/${entityId}/${crypto.randomUUID()}-${safeName}`;

  const admin = createAdminClient();
  const fileBuffer = new Uint8Array(await file.arrayBuffer());
  const { error: uploadError } = await admin.storage.from(bucket).upload(objectKey, fileBuffer, {
    contentType: effectiveMime,
    cacheControl: '300',
    upsert: false,
  });
  if (uploadError) {
    throw new AppError('internal', `Storage upload failed: ${uploadError.message}`);
  }

  // Insert documents + entity_documents rows in one transaction so a partial
  // success doesn't leave an orphan file. If the inserts fail, the storage
  // object stays — that's an acceptable trade since the next upload retry
  // generates a fresh uuid key.
  const result = await db.transaction(async (tx) => {
    const [docRow] = await tx
      .insert(documents)
      .values({
        entityType,
        entityId,
        bucket,
        storagePath: objectKey,
        visibility: visibility as z.infer<typeof DocumentVisibility>,
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
        signedAt,
        expiresAt,
        signedByUs,
        signedByThem,
        version: 1,
        status: 'active',
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: entityDocuments.id });
    if (!edRow) throw new AppError('internal', 'entity_documents insert returned no row');

    return { documentId: docRow.id, entityDocumentId: edRow.id };
  });

  await logActivity({
    entityType,
    entityId,
    actorId: ctx.userId,
    kind: 'document.uploaded',
    summary: `Uploaded ${kind.replace('_', ' ')}: ${file.name}`,
    payload: {
      documentId: result.documentId,
      kind,
      mime: effectiveMime,
      sizeBytes: file.size,
    },
  });

  revalidateEntityDetail(entityType, entityId);

  return result;
}

/**
 * Replace an existing entity_document with a new version (SPEC-AMENDMENT-001
 * §10 versioning). Pipeline mirrors uploadDocument with one addition:
 *
 *   - the new row's `version` is `existing.version + 1`
 *   - the new row's `supersedes_id` points at `existing.id`
 *   - `existing.status` flips to `'superseded'`
 *
 * Both the new entity_documents insert and the existing row's status flip
 * run inside one transaction so a partial replacement cannot leave the chain
 * with two active versions. The old file stays in storage and the v1 row
 * stays in the DB — auditable history is the whole point of versioning.
 *
 * `entityDocumentId` is the row id in `entity_documents` (not the underlying
 * `documents.id`). The caller passes the new file via FormData under the
 * `file` key — and optionally an updated `title` / `signedAt` / `expiresAt`
 * / `signedByUs` / `signedByThem`.
 */
export async function replaceDocument(
  entityDocumentId: string,
  formData: FormData,
): Promise<{ documentId: string; entityDocumentId: string }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'upload_document');

  const existingRows = await db
    .select()
    .from(entityDocuments)
    .where(and(eq(entityDocuments.id, entityDocumentId), isNull(entityDocuments.deletedAt)))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) {
    throw new AppError('not_found', `Document ${entityDocumentId} not found`);
  }
  if (existing.status !== 'active') {
    throw new AppError(
      'conflict',
      `Cannot replace document in status ${existing.status} — only active versions can be superseded.`,
    );
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    throw new AppError('validation', 'Missing or invalid file in upload payload.');
  }
  if (file.size === 0) {
    throw new AppError('validation', 'File is empty.');
  }
  if (file.size > MAX_BYTES_DEFAULT) {
    throw new AppError(
      'storage.size_exceeded',
      `File exceeds ${Math.round(MAX_BYTES_DEFAULT / 1024 / 1024)} MB limit.`,
    );
  }

  // Reuse the existing row's metadata for fields the caller didn't override.
  // The kind stays the same — a replacement is a new version of the same
  // document, not a re-classification.
  const titleFd = formData.get('title');
  const descriptionFd = formData.get('description');
  const signedAtFd = formData.get('signedAt');
  const expiresAtFd = formData.get('expiresAt');
  const signedByUsFd = formData.get('signedByUs');
  const signedByThemFd = formData.get('signedByThem');
  const title = typeof titleFd === 'string' ? titleFd : existing.title;
  const description = typeof descriptionFd === 'string' ? descriptionFd : existing.description;
  const signedAt =
    typeof signedAtFd === 'string' && signedAtFd.length > 0 ? signedAtFd : existing.signedAt;
  const expiresAt =
    typeof expiresAtFd === 'string' && expiresAtFd.length > 0 ? expiresAtFd : existing.expiresAt;
  const signedByUs =
    typeof signedByUsFd === 'string' ? signedByUsFd === 'true' : existing.signedByUs;
  const signedByThem =
    typeof signedByThemFd === 'string' ? signedByThemFd === 'true' : existing.signedByThem;

  const headerBytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const detectedMime = sniffMime(headerBytes, file.type || undefined);
  // Use the sniffed (true) type — detectedMime already falls back to the
  // browser-declared type when the bytes aren't recognized.
  const effectiveMime = detectedMime;

  const { bucket, visibility } = bucketForKind(existing.kind);
  const safeName = safeFilename(file.name);
  const objectKey = `${existing.entityType}/${existing.entityId}/${crypto.randomUUID()}-${safeName}`;

  const admin = createAdminClient();
  const fileBuffer = new Uint8Array(await file.arrayBuffer());
  const { error: uploadError } = await admin.storage.from(bucket).upload(objectKey, fileBuffer, {
    contentType: effectiveMime,
    cacheControl: '300',
    upsert: false,
  });
  if (uploadError) {
    throw new AppError('internal', `Storage upload failed: ${uploadError.message}`);
  }

  const result = await db.transaction(async (tx) => {
    const [docRow] = await tx
      .insert(documents)
      .values({
        entityType: existing.entityType,
        entityId: existing.entityId,
        bucket,
        storagePath: objectKey,
        visibility: visibility as z.infer<typeof DocumentVisibility>,
        category: existing.kind,
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
        entityType: existing.entityType,
        entityId: existing.entityId,
        documentId: docRow.id,
        kind: existing.kind,
        title,
        description,
        signedAt,
        expiresAt,
        signedByUs,
        signedByThem,
        version: existing.version + 1,
        supersedesId: existing.id,
        status: 'active',
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: entityDocuments.id });
    if (!edRow) throw new AppError('internal', 'entity_documents insert returned no row');

    // Flip the previous row to 'superseded'. The supersedes chain is a
    // forward link (new → old); the old row's status tells the list view
    // to hide it by default.
    await tx
      .update(entityDocuments)
      .set({ status: 'superseded', updatedBy: ctx.userId })
      .where(eq(entityDocuments.id, existing.id));

    return { documentId: docRow.id, entityDocumentId: edRow.id };
  });

  await logActivity({
    entityType: existing.entityType,
    entityId: existing.entityId,
    actorId: ctx.userId,
    kind: 'document.superseded',
    summary: `Replaced ${existing.kind.replace('_', ' ')} with v${existing.version + 1}`,
    payload: {
      newDocumentId: result.documentId,
      newEntityDocumentId: result.entityDocumentId,
      supersedesId: existing.id,
      kind: existing.kind,
      version: existing.version + 1,
    },
  });

  revalidateEntityDetail(DocumentEntityType.parse(existing.entityType), existing.entityId);

  return result;
}

/* -------------------------------------------------------------------------- */
/* Read                                                                       */
/* -------------------------------------------------------------------------- */

export type EntityDocumentEntityType = z.infer<typeof DocumentEntityType>;

export type EntityDocumentRow = {
  id: string;
  documentId: string;
  kind: z.infer<typeof DocumentKind>;
  title: string | null;
  description: string | null;
  status: 'active' | 'superseded' | 'expired' | 'soft_deleted';
  version: number;
  signedAt: string | null;
  expiresAt: string | null;
  signedByUs: boolean;
  signedByThem: boolean;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
  createdAt: string;
  supersedesId: string | null;
};

export async function listEntityDocuments(args: {
  entityType: EntityDocumentEntityType;
  entityId: string;
  /** When true, includes superseded + soft-deleted rows. Default false. */
  includeOld?: boolean;
}): Promise<readonly EntityDocumentRow[]> {
  await getActorContext();
  const where = and(
    eq(entityDocuments.entityType, args.entityType),
    eq(entityDocuments.entityId, args.entityId),
    isNull(entityDocuments.deletedAt),
    args.includeOld ? undefined : eq(entityDocuments.status, 'active'),
  );

  const rows = await db
    .select({
      id: entityDocuments.id,
      documentId: entityDocuments.documentId,
      kind: entityDocuments.kind,
      title: entityDocuments.title,
      description: entityDocuments.description,
      status: entityDocuments.status,
      version: entityDocuments.version,
      signedAt: entityDocuments.signedAt,
      expiresAt: entityDocuments.expiresAt,
      signedByUs: entityDocuments.signedByUs,
      signedByThem: entityDocuments.signedByThem,
      mimeType: documents.mimeType,
      sizeBytes: documents.sizeBytes,
      originalFilename: documents.originalFilename,
      createdAt: entityDocuments.createdAt,
      supersedesId: entityDocuments.supersedesId,
    })
    .from(entityDocuments)
    .innerJoin(documents, eq(documents.id, entityDocuments.documentId))
    .where(where)
    .orderBy(desc(entityDocuments.createdAt))
    .limit(200);

  return rows.map(
    (r): EntityDocumentRow => ({
      id: r.id,
      documentId: r.documentId,
      kind: r.kind,
      title: r.title,
      description: r.description,
      status: r.status,
      version: r.version,
      signedAt: r.signedAt,
      expiresAt: r.expiresAt,
      signedByUs: r.signedByUs,
      signedByThem: r.signedByThem,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      originalFilename: r.originalFilename,
      createdAt: r.createdAt.toISOString(),
      supersedesId: r.supersedesId,
    }),
  );
}

export type RecentDocumentRow = {
  id: string;
  documentId: string;
  filename: string;
  kind: string;
  entityType: 'client' | 'vendor' | 'employee' | 'project' | string;
  entityId: string;
  entityName: string | null;
  uploadedBy: string | null;
  createdAt: string;
};

/**
 * Org-wide feed of the most recently filed documents — backs the OS "Inbox"
 * (recent documents) view. Real data: every file uploaded through a creation
 * wizard or a profile's Documents tab shows up here. Resolves the owning
 * entity's display name via a per-type subquery (same approach as the list
 * mappers in server-stub/entity-actions.ts).
 */
export async function listRecentDocuments(limit = 50): Promise<readonly RecentDocumentRow[]> {
  await getActorContext();

  const entityName = sql<string | null>`(
    case ${entityDocuments.entityType}
      when 'client' then (select name from clients where id = ${entityDocuments.entityId})
      when 'vendor' then (select name from vendors where id = ${entityDocuments.entityId})
      when 'employee' then (select full_name from employees where id = ${entityDocuments.entityId})
      when 'project' then (select name from projects where id = ${entityDocuments.entityId})
    end
  )`;

  const rows = await db
    .select({
      id: entityDocuments.id,
      documentId: entityDocuments.documentId,
      filename: documents.originalFilename,
      kind: entityDocuments.kind,
      entityType: entityDocuments.entityType,
      entityId: entityDocuments.entityId,
      entityName,
      uploadedBy: users.fullName,
      createdAt: entityDocuments.createdAt,
    })
    .from(entityDocuments)
    .innerJoin(documents, eq(documents.id, entityDocuments.documentId))
    .leftJoin(users, eq(users.id, entityDocuments.createdBy))
    .where(and(eq(entityDocuments.status, 'active'), isNull(entityDocuments.deletedAt)))
    .orderBy(desc(entityDocuments.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));

  return rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    filename: r.filename,
    kind: r.kind,
    entityType: r.entityType,
    entityId: r.entityId,
    entityName: r.entityName,
    uploadedBy: r.uploadedBy,
    createdAt: r.createdAt.toISOString(),
  }));
}

/* -------------------------------------------------------------------------- */
/* Trash — soft delete / restore / list / permanent delete                    */
/* -------------------------------------------------------------------------- */
//
// A document link (entity_documents row) can be moved to Trash (status flips
// to 'soft_deleted' — hidden from the normal list, file untouched), restored,
// or permanently deleted. Permanent delete removes the link; the underlying
// file + `documents` row are removed too, but ONLY if nothing else still
// references the file (another entity link, or a recorded bill/invoice
// transaction whose source document this is).

async function loadEntityDocForTrash(entityDocumentId: string) {
  const [row] = await db
    .select({
      id: entityDocuments.id,
      status: entityDocuments.status,
      entityType: entityDocuments.entityType,
      entityId: entityDocuments.entityId,
      documentId: entityDocuments.documentId,
      kind: entityDocuments.kind,
    })
    .from(entityDocuments)
    .where(eq(entityDocuments.id, entityDocumentId))
    .limit(1);
  return row ?? null;
}

/** Move an active document to Trash (recoverable). */
export async function softDeleteDocument(entityDocumentId: string): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'delete_document');
  const row = await loadEntityDocForTrash(entityDocumentId);
  if (!row) throw new AppError('not_found', `Document ${entityDocumentId} not found`);
  if (row.status !== 'active') {
    throw new AppError(
      'conflict',
      `Only active documents can be moved to Trash (this one is ${row.status}).`,
    );
  }
  await db
    .update(entityDocuments)
    .set({ status: 'soft_deleted', updatedBy: ctx.userId })
    .where(eq(entityDocuments.id, entityDocumentId));

  await logActivity({
    entityType: row.entityType,
    entityId: row.entityId,
    actorId: ctx.userId,
    kind: 'document.deleted',
    summary: `Moved ${row.kind.replace('_', ' ')} to Trash`,
    payload: { entityDocumentId, documentId: row.documentId, kind: row.kind, trashed: true },
  });
  revalidateEntityDetail(DocumentEntityType.parse(row.entityType), row.entityId);
}

/** Restore a trashed document back to the active list. */
export async function restoreDocument(entityDocumentId: string): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'delete_document');
  const row = await loadEntityDocForTrash(entityDocumentId);
  if (!row) throw new AppError('not_found', `Document ${entityDocumentId} not found`);
  if (row.status !== 'soft_deleted') {
    throw new AppError(
      'conflict',
      `Only items in Trash can be restored (this one is ${row.status}).`,
    );
  }
  await db
    .update(entityDocuments)
    .set({ status: 'active', updatedBy: ctx.userId })
    .where(eq(entityDocuments.id, entityDocumentId));

  await logActivity({
    entityType: row.entityType,
    entityId: row.entityId,
    actorId: ctx.userId,
    kind: 'document.deleted',
    summary: `Restored ${row.kind.replace('_', ' ')} from Trash`,
    payload: { entityDocumentId, documentId: row.documentId, kind: row.kind, restored: true },
  });
  revalidateEntityDetail(DocumentEntityType.parse(row.entityType), row.entityId);
}

/** List an entity's trashed documents (status = soft_deleted). */
export async function listTrashedDocuments(args: {
  entityType: EntityDocumentEntityType;
  entityId: string;
}): Promise<readonly EntityDocumentRow[]> {
  await getActorContext();
  const rows = await db
    .select({
      id: entityDocuments.id,
      documentId: entityDocuments.documentId,
      kind: entityDocuments.kind,
      title: entityDocuments.title,
      description: entityDocuments.description,
      status: entityDocuments.status,
      version: entityDocuments.version,
      signedAt: entityDocuments.signedAt,
      expiresAt: entityDocuments.expiresAt,
      signedByUs: entityDocuments.signedByUs,
      signedByThem: entityDocuments.signedByThem,
      mimeType: documents.mimeType,
      sizeBytes: documents.sizeBytes,
      originalFilename: documents.originalFilename,
      createdAt: entityDocuments.createdAt,
      updatedAt: entityDocuments.updatedAt,
      supersedesId: entityDocuments.supersedesId,
    })
    .from(entityDocuments)
    .innerJoin(documents, eq(documents.id, entityDocuments.documentId))
    .where(
      and(
        eq(entityDocuments.entityType, args.entityType),
        eq(entityDocuments.entityId, args.entityId),
        eq(entityDocuments.status, 'soft_deleted'),
      ),
    )
    .orderBy(desc(entityDocuments.updatedAt))
    .limit(200);

  return rows.map(
    (r): EntityDocumentRow => ({
      id: r.id,
      documentId: r.documentId,
      kind: r.kind,
      title: r.title,
      description: r.description,
      status: r.status,
      version: r.version,
      signedAt: r.signedAt,
      expiresAt: r.expiresAt,
      signedByUs: r.signedByUs,
      signedByThem: r.signedByThem,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      originalFilename: r.originalFilename,
      createdAt: r.createdAt.toISOString(),
      supersedesId: r.supersedesId,
    }),
  );
}

/**
 * Permanently delete a trashed document. Removes the entity link; the file +
 * `documents` row are destroyed too, but only when nothing else references the
 * file (another active/trashed link, or a transaction's source document — e.g.
 * a recorded bill/invoice, which must keep its copy). Returns whether the file
 * itself was removed.
 */
export async function permanentlyDeleteDocument(
  entityDocumentId: string,
): Promise<{ fileRemoved: boolean }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'hard_delete_document');
  const row = await loadEntityDocForTrash(entityDocumentId);
  if (!row) throw new AppError('not_found', `Document ${entityDocumentId} not found`);
  if (row.status !== 'soft_deleted') {
    throw new AppError(
      'conflict',
      'Only items in Trash can be permanently deleted. Move it to Trash first.',
    );
  }

  const [doc] = await db
    .select({ bucket: documents.bucket, storagePath: documents.storagePath })
    .from(documents)
    .where(eq(documents.id, row.documentId))
    .limit(1);

  let fileRemoved = false;
  await db.transaction(async (tx) => {
    await tx.delete(entityDocuments).where(eq(entityDocuments.id, entityDocumentId));

    const otherLinkRows = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(entityDocuments)
      .where(eq(entityDocuments.documentId, row.documentId));
    const txnRefRows = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(transactions)
      .where(eq(transactions.sourceDocumentId, row.documentId));
    const otherLinks = otherLinkRows[0]?.n ?? 0;
    const txnRefs = txnRefRows[0]?.n ?? 0;

    if (otherLinks === 0 && txnRefs === 0) {
      await tx.delete(documents).where(eq(documents.id, row.documentId));
      fileRemoved = true;
    }
  });

  // Remove the storage object only after the DB rows are gone (best-effort —
  // an orphaned object is acceptable; a dangling row pointing at a missing
  // file is not).
  if (fileRemoved && doc?.bucket && doc.storagePath) {
    try {
      const admin = createAdminClient();
      await admin.storage.from(doc.bucket).remove([doc.storagePath]);
    } catch {
      // best-effort
    }
  }

  await logActivity({
    entityType: row.entityType,
    entityId: row.entityId,
    actorId: ctx.userId,
    kind: 'document.deleted',
    summary: `Permanently deleted ${row.kind.replace('_', ' ')}`,
    payload: { documentId: row.documentId, kind: row.kind, permanentDelete: true, fileRemoved },
  });
  revalidateEntityDetail(DocumentEntityType.parse(row.entityType), row.entityId);
  return { fileRemoved };
}
