'use server';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { invoices } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

import { renderInvoicePdf } from './pdf/invoice';
import { loadInvoicePdfData } from './pdf/load-data';

/**
 * Render a DRAFT invoice's PDF for on-screen preview.
 *
 * Pure read: it does NOT store the file or post to the ledger — that is
 * `sendInvoice` (the "Save & download" / finalise step, which also makes the
 * invoice immutable). The selected/ default theme is applied automatically by
 * `loadInvoicePdfData`. Returns base64 PDF bytes for the client to display and
 * discard.
 *
 * Draft-only: a sent invoice already has a stored PDF (`sourceDocumentId`);
 * open that via its signed URL instead of re-rendering.
 */
export async function renderInvoicePreview(
  invoiceId: string,
): Promise<{ base64: string; documentNumber: string }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'create_invoice');
  const id = z.string().uuid().parse(invoiceId);

  const [inv] = await db
    .select({
      id: invoices.id,
      state: invoices.state,
      documentNumber: invoices.documentNumber,
    })
    .from(invoices)
    .where(eq(invoices.id, id))
    .limit(1);
  if (!inv) throw new AppError('not_found', `invoice ${id} not found`);
  if (inv.state !== 'draft') {
    throw new AppError(
      'validation',
      `invoice ${id} is ${inv.state}; preview is for drafts only. Open the stored PDF instead.`,
    );
  }

  const data = await loadInvoicePdfData(id);
  const bytes = await renderInvoicePdf(data);
  return {
    base64: Buffer.from(bytes).toString('base64'),
    documentNumber: inv.documentNumber,
  };
}
