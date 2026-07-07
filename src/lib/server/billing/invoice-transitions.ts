'use server';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { invoiceLines, invoices } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { logActivity } from '@/lib/activity';
import { logAudit } from '@/lib/audit';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { createDraftTransaction, postTransaction, reverseTransaction } from '@/lib/server/ledger';

import { renderInvoicePdf } from './pdf/invoice';
import { loadInvoicePdfData } from './pdf/load-data';
import { uploadInvoicePdf } from './pdf/upload';

/**
 * Invoice state-transition actions.
 *
 *   sendInvoice(id)        — draft → sent. Generates the PDF, uploads to
 *     `internal-docs/invoices/<id>.pdf`, creates the `documents` row,
 *     then posts to the ledger via the existing client_invoice template
 *     (Dr 1200 / Cr 4100 / Cr 2120 per captured tax). On success, the
 *     invoice row carries `sourceDocumentId` + `postedTransactionId`
 *     and state='sent'. Razorpay payment-link (Phase 4) and Resend email
 *     (Phase 9) are still deferred — flags surface in the return value.
 *
 *   voidInvoice(id, reason) — any-non-void → void. If a posted ledger
 *     transaction exists, reverse it; otherwise just flip the state.
 *
 *   markInvoiceViewed(id)   — bumps viewed_at. Idempotent (only sets if NULL).
 */

const InvoiceIdSchema = z.string().uuid();

export type SendInvoiceResult = {
  id: string;
  state: 'sent';
  documentId: string;
  transactionId: string;
  validationFlags: Array<{ code: string; severity: string; message: string }>;
  pendingGatewayLink: boolean;
  pendingEmail: boolean;
};

export async function sendInvoice(id: string): Promise<SendInvoiceResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'send_invoice');
  const invoiceId = InvoiceIdSchema.parse(id);

  const [current] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!current) throw new AppError('not_found', `invoice ${invoiceId} not found`);
  if (current.state !== 'draft') {
    throw new AppError(
      'validation',
      `invoice ${invoiceId} is ${current.state}; only drafts may be sent.`,
    );
  }
  if (current.capturedTotalPaise <= 0n) {
    throw new AppError(
      'validation',
      'Invoice total must be > 0 to send. Add at least one priced line.',
    );
  }

  // Step 1 — render the PDF from a freshly-loaded snapshot.
  const pdfData = await loadInvoicePdfData(invoiceId);
  const pdfBytes = await renderInvoicePdf(pdfData);

  // Step 2 — upload to Storage and create the documents row. Storage
  // write is outside the DB transaction; a later-step failure leaves
  // the file in place (acceptable for v1 — the file is namespaced by
  // invoice id and overwritten on the next sendInvoice attempt).
  const { documentId } = await uploadInvoicePdf({
    invoiceId,
    clientId: current.clientId,
    documentNumber: current.documentNumber,
    pdfBytes,
    actorId: ctx.userId,
  });

  // Step 3 — load lines for the posting template.
  const lines = await db
    .select({
      description: invoiceLines.description,
      capturedTaxableValuePaise: invoiceLines.capturedTaxableValuePaise,
      capturedTaxAmountPaise: invoiceLines.capturedTaxAmountPaise,
      capturedTaxRateBps: invoiceLines.capturedTaxRateBps,
    })
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId));
  if (lines.length === 0) {
    throw new AppError('validation', `invoice ${invoiceId} has no lines.`);
  }

  // Step 4 — create + post the ledger transaction via the existing
  // client_invoice posting template (Dr 1200 / Cr 4100 / Cr 2120 per
  // captured tax).
  const draft = await createDraftTransaction(ctx, {
    kind: 'client_invoice',
    input: {
      clientId: current.clientId,
      projectId: current.projectId ?? undefined,
      invoiceDocumentId: documentId,
      invoiceNumber: current.documentNumber,
      txnDate: current.documentDate,
      lineItems: lines.map((l) => ({
        description: l.description,
        amountPaise: l.capturedTaxableValuePaise,
        gstAmountPaiseCaptured: l.capturedTaxAmountPaise,
        gstRateBpsCaptured: l.capturedTaxRateBps,
      })),
      notes: current.notes,
    },
  });

  // Block-severity flags raise inside createDraftTransaction; warns
  // attach to draft.validationFlags. The dashboard surfaces them at
  // compose time; sending here implies the user has acknowledged.
  const acknowledgedFlags = draft.validationFlags
    .filter((f) => f.severity === 'warn')
    .map((f) => f.code);
  await postTransaction(ctx, {
    transactionId: draft.transactionId,
    acknowledgedFlags,
  });

  // Step 5 — flip invoice state + back-link the doc + posted txn.
  await db.transaction(async (tx) => {
    await tx
      .update(invoices)
      .set({
        state: 'sent',
        sentAt: new Date(),
        sourceDocumentId: documentId,
        postedTransactionId: draft.transactionId,
        validationFlags: draft.validationFlags as unknown as object[],
        updatedBy: ctx.userId,
      })
      .where(eq(invoices.id, invoiceId));

    await logActivity(
      {
        entityType: 'client',
        entityId: current.clientId,
        actorId: ctx.userId,
        kind: 'invoice.sent',
        summary: `Invoice ${current.documentNumber} sent`,
        payload: {
          invoice_id: invoiceId,
          document_number: current.documentNumber,
          captured_total_paise: current.capturedTotalPaise.toString(),
          source_document_id: documentId,
          posted_transaction_id: draft.transactionId,
          warn_flags: acknowledgedFlags,
        },
      },
      tx as unknown as typeof db,
    );

    await logAudit(
      {
        actorId: ctx.userId,
        entityType: 'invoice',
        entityId: invoiceId,
        action: 'update',
        changes: {
          state: { before: 'draft', after: 'sent' },
          source_document_id: { before: null, after: documentId },
          posted_transaction_id: { before: null, after: draft.transactionId },
        },
      },
      tx as unknown as typeof db,
    );
  });

  return {
    id: invoiceId,
    state: 'sent' as const,
    documentId,
    transactionId: draft.transactionId,
    validationFlags: draft.validationFlags,
    pendingGatewayLink: true, // Phase 4 — Razorpay
    pendingEmail: true, //         Phase 9 — Resend
  };
}

export type VoidInvoiceResult = {
  id: string;
  state: 'void';
  reversalTransactionId: string | null;
};

export async function voidInvoice(id: string, reason: string): Promise<VoidInvoiceResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'void_invoice');
  const invoiceId = InvoiceIdSchema.parse(id);

  if (reason.trim().length < 10) {
    throw new AppError('validation', 'Void reason must be at least 10 characters.');
  }

  const [current] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!current) throw new AppError('not_found', `invoice ${invoiceId} not found`);
  if (current.state === 'void') {
    return { id: invoiceId, state: 'void', reversalTransactionId: null };
  }
  if (current.state === 'paid') {
    throw new AppError(
      'validation',
      `invoice ${invoiceId} is already paid; issue a credit note instead of deleting.`,
    );
  }

  // GSTR-1 window: an invoice can be deleted in its own month or until the
  // 11th of the following month — after that its GST output has been filed
  // and the books must not change. (deleteDeadline = the 11th, inclusive.)
  {
    const docDate = new Date(`${String(current.documentDate).slice(0, 10)}T00:00:00Z`);
    const deadline = new Date(Date.UTC(docDate.getUTCFullYear(), docDate.getUTCMonth() + 1, 11));
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    if (today.getTime() > deadline.getTime()) {
      throw new AppError(
        'validation',
        `Invoice ${current.documentNumber} is past its GSTR-1 window (deletable until ${deadline
          .toISOString()
          .slice(0, 10)}). Issue a credit note instead.`,
      );
    }
  }

  // If a ledger txn was posted (post-Phase 2.4), reverse it FIRST. Outside the
  // invoice-update transaction because reverseTransaction has its own
  // tx-boundary discipline (audit + activity logs).
  let reversalTransactionId: string | null = null;
  if (current.postedTransactionId) {
    const result = await reverseTransaction(ctx, {
      transactionId: current.postedTransactionId,
      reason: `Invoice ${current.documentNumber} voided: ${reason}`,
    });
    reversalTransactionId = result.reversalTransactionId;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(invoices)
      .set({
        state: 'void',
        notes: appendNote(current.notes, `[void] ${reason}`),
        updatedBy: ctx.userId,
      })
      .where(eq(invoices.id, invoiceId));

    if (current.clientId) {
      await logActivity(
        {
          entityType: 'client',
          entityId: current.clientId,
          actorId: ctx.userId,
          kind: 'invoice.voided',
          summary: `Invoice ${current.documentNumber} voided`,
          payload: {
            invoice_id: invoiceId,
            document_number: current.documentNumber,
            reason,
            reversal_transaction_id: reversalTransactionId,
          },
        },
        tx as unknown as typeof db,
      );
    }
    await logAudit(
      {
        actorId: ctx.userId,
        entityType: 'invoice',
        entityId: invoiceId,
        action: 'update',
        changes: { state: { before: current.state, after: 'void' }, reason },
      },
      tx as unknown as typeof db,
    );
  });

  return { id: invoiceId, state: 'void', reversalTransactionId };
}

function appendNote(existing: string | null, addition: string): string {
  if (!existing || existing.trim().length === 0) return addition;
  return `${existing}\n${addition}`;
}

/**
 * Idempotent — only writes the first time. Future click-tracking link
 * (Phase 9) calls this on first open.
 */
export async function markInvoiceViewed(id: string): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'create_invoice');
  const invoiceId = InvoiceIdSchema.parse(id);

  const [current] = await db
    .select({ id: invoices.id, viewedAt: invoices.viewedAt, state: invoices.state })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!current) return; // silent for tracking-pixel use
  if (current.viewedAt !== null) return;
  if (current.state === 'draft') return; // drafts can't be "viewed" externally

  await db
    .update(invoices)
    .set({ viewedAt: new Date(), updatedBy: ctx.userId })
    .where(eq(invoices.id, invoiceId));
}
