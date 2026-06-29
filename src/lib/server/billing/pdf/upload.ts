import 'server-only';

import { db, type DbClient } from '@/lib/db/client';
import { documents } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * Upload billing-document PDF bytes to Supabase Storage and create the
 * matching `documents` row. Returns the new document id, ready to be
 * used as `transactions.source_document_id` by the ledger post path.
 *
 * Bucket: `internal-docs` (CLAUDE rule #26: KYC-only goes to
 * `restricted-kyc`; everything else here). Visibility: `internal`.
 *
 * Idempotency: storage upload uses `upsert: true`, so re-sending the
 * same document overwrites the prior PDF bytes in place. The `documents`
 * row insert is NOT idempotent on its own; callers should pass an
 * existing `existingDocumentId` if they intend to refresh bytes for an
 * already-tracked entity (the row is reused; we just rewrite the file).
 */

export type BillingDocCategory =
  | 'invoice'
  | 'credit_note'
  | 'receipt_voucher'
  | 'refund_voucher'
  | 'payment_voucher';

const STORAGE_PREFIX: Record<BillingDocCategory, string> = {
  invoice: 'invoices',
  credit_note: 'credit_notes',
  receipt_voucher: 'receipt_vouchers',
  refund_voucher: 'refund_vouchers',
  payment_voucher: 'payment_vouchers',
};

export type UploadBillingPdfArgs = {
  /** Category-specific id (invoiceId / creditNoteId / voucherId). Used as the
   *  storage path discriminator. */
  ownerId: string;
  /** Entity to attach the documents row to (typically the client). */
  attachToEntity: { entityType: 'client' | 'vendor'; entityId: string };
  documentNumber: string;
  category: BillingDocCategory;
  pdfBytes: Uint8Array;
  /** Pass the existing documents.id to refresh in place; omit to insert a new row. */
  existingDocumentId?: string;
  actorId: string;
};

export async function uploadBillingPdf(
  args: UploadBillingPdfArgs,
  client: DbClient = db,
): Promise<{
  documentId: string;
  bucket: 'internal-docs';
  storagePath: string;
  sizeBytes: number;
}> {
  const bucket = 'internal-docs' as const;
  const storagePath = `${STORAGE_PREFIX[args.category]}/${args.ownerId}.pdf`;

  const admin = createAdminClient();
  const { error: uploadErr } = await admin.storage.from(bucket).upload(storagePath, args.pdfBytes, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (uploadErr) {
    throw new AppError('internal', `Failed to upload ${args.category} PDF to Storage.`, {
      cause: uploadErr,
      detail: { bucket, storagePath, owner_id: args.ownerId, category: args.category },
    });
  }

  const sizeBytes = args.pdfBytes.byteLength;
  const filename = `${args.documentNumber.replace(/[^\w.\-/]+/g, '_')}.pdf`;

  if (args.existingDocumentId) {
    await client
      .update(documents)
      .set({
        bucket,
        storagePath,
        sizeBytes,
        originalFilename: filename,
        mimeType: 'application/pdf',
        updatedBy: args.actorId,
      })
      .where(eq(documents.id, args.existingDocumentId));
    return { documentId: args.existingDocumentId, bucket, storagePath, sizeBytes };
  }

  const [row] = await client
    .insert(documents)
    .values({
      entityType: args.attachToEntity.entityType,
      entityId: args.attachToEntity.entityId,
      bucket,
      storagePath,
      visibility: 'internal',
      category: args.category,
      originalFilename: filename,
      mimeType: 'application/pdf',
      sizeBytes,
      createdBy: args.actorId,
      updatedBy: args.actorId,
    })
    .returning({ id: documents.id });
  if (!row) {
    throw new AppError('internal', 'documents.insert returned no row');
  }
  return { documentId: row.id, bucket, storagePath, sizeBytes };
}

/** Back-compat shim — keeps the invoice-specific call site clean. */
export async function uploadInvoicePdf(
  args: {
    invoiceId: string;
    clientId: string;
    documentNumber: string;
    pdfBytes: Uint8Array;
    existingDocumentId?: string;
    actorId: string;
  },
  client: DbClient = db,
) {
  return uploadBillingPdf(
    {
      ownerId: args.invoiceId,
      attachToEntity: { entityType: 'client', entityId: args.clientId },
      documentNumber: args.documentNumber,
      category: 'invoice',
      pdfBytes: args.pdfBytes,
      existingDocumentId: args.existingDocumentId,
      actorId: args.actorId,
    },
    client,
  );
}

import { eq } from 'drizzle-orm';
