'use server';

import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { documents, entityDocuments, invoiceLines, invoices, transactions } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { logActivity } from '@/lib/activity';
import { logAudit } from '@/lib/audit';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { createDraftTransaction, postTransaction } from '@/lib/server/ledger';
import { discardDraftTransaction } from '@/lib/server/entities/client-transactions';

import { createDraftInvoice, getClientBillingReadiness, updateDraftInvoice } from './invoices';

/**
 * Records an UPLOADED client invoice (a PDF/scan added via the client's
 * Documents tab with kind 'invoice') as a real invoice in the books.
 *
 * Unlike the composer flow (createDraftInvoice → sendInvoice), the invoice
 * artifact already exists — no PDF is generated. The flow is:
 *
 *   1. createDraftInvoice — full validation (client billing readiness,
 *      FY-unique number, project-belongs-to-client) + invoices/invoice_lines
 *      rows. Amounts are captured-not-computed, straight off the paper, but
 *      reconciled (total must equal subtotal + GST) so the ledger posting and
 *      the AR/receipts side can never diverge.
 *   2. Post the client_invoice ledger transaction (Dr 1200 / Cr 4100 /
 *      Cr 2120) with the uploaded file as the transaction's source document.
 *      Posting amounts come from the STORED draft, never the request payload.
 *   3. Flip the invoice to 'sent' with sourceDocumentId = the uploaded file,
 *      so AR aging, per-client P&L and the project's Income KPI all see it.
 *
 * Retry/replay safety (per uploaded document, keyed on documents.id):
 *   - invoice already past draft → returns ok with alreadyRecorded.
 *   - draft exists from a failed attempt → the draft is synced to the
 *     (possibly corrected) payload via updateDraftInvoice, then posted.
 *   - a posted ledger txn for this number+document already exists (crash
 *     between post and state-flip) → it is adopted instead of re-posted.
 *   - a draft ledger txn for this number+document exists → discarded and
 *     rebuilt (its unique external_ref would otherwise brick every retry);
 *     posting failures likewise discard their own draft txn before failing.
 *
 * Returns the safe `{ ok } | { ok:false, message }` shape so the upload
 * dialog can toast failures (the document itself is already uploaded).
 */

/** Far below the int8 ceiling — a typo guard, not a business rule. */
const MAX_AMOUNT_PAISE = 10_000_000_000_000_000n; // ₹100,000 crore

const RecordUploadedInvoiceSchema = z.object({
  clientId: z.string().uuid(),
  projectId: z.string().uuid().nullish(),
  /** documents.id returned by uploadDocument for the invoice file. */
  uploadedDocumentId: z.string().uuid(),
  /** The number printed on the uploaded invoice — required, used verbatim. */
  documentNumber: z.string().trim().min(1).max(60),
  documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'documentDate must be YYYY-MM-DD'),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be YYYY-MM-DD')
    .nullish(),
  /** One synthesized line carries these captured amounts (bigint paise). */
  description: z.string().trim().min(1).max(1000).nullish(),
  subtotalPaise: z.bigint().positive('Subtotal must be greater than zero.'),
  cgstPaise: z.bigint().nonnegative().default(0n),
  sgstPaise: z.bigint().nonnegative().default(0n),
  igstPaise: z.bigint().nonnegative().default(0n),
  capturedTotalPaise: z.bigint().positive('Invoice total must be greater than zero.'),
  notes: z.string().trim().max(4000).nullish(),
});

export type RecordUploadedInvoiceInput = z.input<typeof RecordUploadedInvoiceSchema>;

export type RecordUploadedInvoiceResult =
  | { ok: true; invoiceId: string; documentNumber: string; alreadyRecorded: boolean }
  | { ok: false; message: string };

function fail(message: string): RecordUploadedInvoiceResult {
  return { ok: false, message };
}

/** Implied GST rate captured off the paper (taxTotal / taxable), rounded bps.
 *  Guarded to [0, 10000] by the tax ≤ subtotal validation below. */
function impliedTaxRateBps(taxablePaise: bigint, taxPaise: bigint): number {
  if (taxablePaise <= 0n || taxPaise <= 0n) return 0;
  const bps = Number((taxPaise * 10000n + taxablePaise / 2n) / taxablePaise);
  return Math.max(0, Math.min(10000, bps));
}

export async function recordUploadedClientInvoice(
  input: RecordUploadedInvoiceInput,
): Promise<RecordUploadedInvoiceResult> {
  try {
    const ctx = await getActorContext();
    // Creating + posting in one step needs both billing capabilities AND
    // ledger posting rights — checked up front so no draft is ever created
    // for a caller who could not complete the flow.
    requireCapability(ctx, 'create_invoice');
    requireCapability(ctx, 'send_invoice');
    requireCapability(ctx, 'post_transaction');

    const v = RecordUploadedInvoiceSchema.parse(input);

    const taxTotalPaise = v.cgstPaise + v.sgstPaise + v.igstPaise;

    // Captured amounts must reconcile: the ledger posts subtotal + GST while
    // AR/receipts settle against the captured total — a mismatch would leave
    // a permanent residue in the receivables subledger.
    if (v.capturedTotalPaise !== v.subtotalPaise + taxTotalPaise) {
      return fail(
        'Total must equal Subtotal + CGST + SGST + IGST. Adjust the amounts to match the printed invoice.',
      );
    }
    if (taxTotalPaise > v.subtotalPaise) {
      return fail('GST total cannot exceed the taxable amount — check the captured amounts.');
    }
    for (const [label, amount] of [
      ['Subtotal', v.subtotalPaise],
      ['Total', v.capturedTotalPaise],
    ] as const) {
      if (amount > MAX_AMOUNT_PAISE) {
        return fail(`${label} looks too large — check for a typo.`);
      }
    }

    // The uploaded file must be a live document belonging to THIS client.
    const [doc] = await db
      .select({ entityType: documents.entityType, entityId: documents.entityId })
      .from(documents)
      .where(and(eq(documents.id, v.uploadedDocumentId), isNull(documents.deletedAt)))
      .limit(1);
    if (!doc) return fail('The uploaded document could not be found.');
    if (doc.entityType !== 'client' || doc.entityId !== v.clientId) {
      return fail('The uploaded document does not belong to this client.');
    }

    // Place of supply, same source the composer uses (client GSTIN state).
    const readiness = await getClientBillingReadiness(v.clientId);
    if (!readiness.stateCode) {
      return fail(
        "Couldn't determine the client's place of supply from their GSTIN. Fix the client's GSTIN (its first two digits are the state code), then record the invoice.",
      );
    }

    const lineDescription = v.description ?? `As per uploaded invoice ${v.documentNumber}`;
    const taxRateBps = impliedTaxRateBps(v.subtotalPaise, taxTotalPaise);
    const idempotencyKey = `uploaded-invoice:${v.uploadedDocumentId}`;

    const invoiceFields = {
      projectId: v.projectId ?? null,
      documentNumber: v.documentNumber,
      documentDate: v.documentDate,
      dueDate: v.dueDate ?? null,
      subtotalPaise: v.subtotalPaise,
      capturedTaxTotalPaise: taxTotalPaise,
      capturedTotalPaise: v.capturedTotalPaise,
      placeOfSupply: readiness.stateCode,
      capturedTaxSplit: {
        cgst_paise: v.cgstPaise,
        sgst_paise: v.sgstPaise,
        igst_paise: v.igstPaise,
      },
      notes: v.notes ?? null,
      lines: [
        {
          lineNo: 1,
          description: lineDescription,
          qty: 1,
          ratePaise: v.subtotalPaise,
          capturedTaxableValuePaise: v.subtotalPaise,
          capturedTaxRateBps: taxRateBps,
          capturedTaxAmountPaise: taxTotalPaise,
        },
      ],
    };

    // Find-or-create the draft. A pre-existing draft (failed earlier attempt)
    // is synced to the current — possibly corrected — payload before posting.
    const [existing] = await db
      .select({ id: invoices.id, state: invoices.state, documentNumber: invoices.documentNumber })
      .from(invoices)
      .where(eq(invoices.idempotencyKey, idempotencyKey))
      .limit(1);

    let invoiceId: string;
    if (existing) {
      if (existing.state !== 'draft') {
        return {
          ok: true,
          invoiceId: existing.id,
          documentNumber: existing.documentNumber,
          alreadyRecorded: true,
        };
      }
      invoiceId = existing.id;
      await updateDraftInvoice(invoiceId, invoiceFields);
    } else {
      const draft = await createDraftInvoice({
        clientId: v.clientId,
        idempotencyKey,
        ...invoiceFields,
      });
      invoiceId = draft.id;
    }

    // Post from the STORED draft — the single source of truth.
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!inv) return fail('The invoice record could not be read back. Please try again.');
    if (inv.state !== 'draft') {
      return {
        ok: true,
        invoiceId,
        documentNumber: inv.documentNumber,
        alreadyRecorded: true,
      };
    }
    const storedLines = await db
      .select({
        description: invoiceLines.description,
        capturedTaxableValuePaise: invoiceLines.capturedTaxableValuePaise,
        capturedTaxAmountPaise: invoiceLines.capturedTaxAmountPaise,
        capturedTaxRateBps: invoiceLines.capturedTaxRateBps,
      })
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceId));
    if (storedLines.length === 0) {
      return fail('The invoice draft has no lines. Finish it from the client’s Invoices tab.');
    }

    // The ledger keys client_invoice transactions on the invoice NUMBER
    // (external_ref is globally unique). Handle a pre-existing transaction:
    // ours (same source document) → adopt if posted, rebuild if draft;
    // someone else's (e.g. the same number from another financial year) →
    // refuse with an accurate message.
    const externalRef = `client_invoice:${inv.documentNumber}`;
    const [existingTxn] = await db
      .select({
        id: transactions.id,
        status: transactions.status,
        sourceDocumentId: transactions.sourceDocumentId,
      })
      .from(transactions)
      .where(eq(transactions.externalRef, externalRef))
      .limit(1);

    let postedTransactionId: string | null = null;
    let warnFlags: string[] = [];
    let txnValidationFlags: object[] | null = null;

    if (existingTxn) {
      if (existingTxn.sourceDocumentId !== v.uploadedDocumentId) {
        return fail(
          `An entry for invoice number "${inv.documentNumber}" already exists in the books — possibly from another financial year. Use a distinct invoice number.`,
        );
      }
      if (existingTxn.status === 'posted') {
        // Crash-window heal: posted on a previous attempt, flip never landed.
        postedTransactionId = existingTxn.id;
      } else if (existingTxn.status === 'draft') {
        // Orphan from a previous failed attempt — discard and rebuild.
        await discardDraftTransaction(existingTxn.id);
      } else {
        return fail(
          `A previous ledger entry for "${inv.documentNumber}" was reversed. Check the client's Transactions tab before recording this invoice again.`,
        );
      }
    }

    try {
      if (!postedTransactionId) {
        const txn = await createDraftTransaction(ctx, {
          kind: 'client_invoice',
          input: {
            clientId: inv.clientId,
            projectId: inv.projectId ?? undefined,
            invoiceDocumentId: v.uploadedDocumentId,
            invoiceNumber: inv.documentNumber,
            txnDate: inv.documentDate,
            lineItems: storedLines.map((l) => ({
              description: l.description,
              amountPaise: l.capturedTaxableValuePaise,
              gstAmountPaiseCaptured: l.capturedTaxAmountPaise,
              gstRateBpsCaptured: l.capturedTaxRateBps,
            })),
            notes: inv.notes,
          },
        });
        warnFlags = txn.validationFlags.filter((f) => f.severity === 'warn').map((f) => f.code);
        try {
          await postTransaction(ctx, {
            transactionId: txn.transactionId,
            acknowledgedFlags: warnFlags,
          });
        } catch (postErr) {
          // Remove the draft txn so its unique external_ref never bricks
          // the retry; best-effort — a leftover draft is still recoverable
          // from the client's Transactions tab.
          await discardDraftTransaction(txn.transactionId).catch(() => {});
          throw postErr;
        }
        postedTransactionId = txn.transactionId;
        txnValidationFlags = txn.validationFlags as unknown as object[];
      }

      await db.transaction(async (tx) => {
        await tx
          .update(invoices)
          .set({
            state: 'sent',
            sentAt: new Date(),
            sourceDocumentId: v.uploadedDocumentId,
            postedTransactionId,
            ...(txnValidationFlags ? { validationFlags: txnValidationFlags } : {}),
            updatedBy: ctx.userId,
          })
          .where(eq(invoices.id, invoiceId));

        await logActivity(
          {
            entityType: 'client',
            entityId: inv.clientId,
            actorId: ctx.userId,
            kind: 'invoice.sent',
            summary: `Invoice ${inv.documentNumber} recorded from uploaded document`,
            payload: {
              invoice_id: invoiceId,
              document_number: inv.documentNumber,
              captured_total_paise: inv.capturedTotalPaise.toString(),
              source_document_id: v.uploadedDocumentId,
              posted_transaction_id: postedTransactionId,
              recorded_from_upload: true,
              project_id: inv.projectId ?? null,
              warn_flags: warnFlags,
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
              recorded_from_upload: true,
              source_document_id: { before: null, after: v.uploadedDocumentId },
              posted_transaction_id: { before: null, after: postedTransactionId },
            },
          },
          tx as unknown as typeof db,
        );
      });
    } catch (postErr) {
      const msg = postErr instanceof AppError ? postErr.message : 'posting failed unexpectedly.';
      console.error('[billing/record-uploaded-invoice] posting failed:', postErr);
      return fail(
        `Invoice ${inv.documentNumber} was saved as a draft, but could not be posted to the books: ${msg} You can retry, or finish it from the client's Invoices tab (that path generates a fresh PDF instead of using the uploaded file).`,
      );
    }

    return {
      ok: true,
      invoiceId,
      documentNumber: inv.documentNumber,
      alreadyRecorded: false,
    };
  } catch (e) {
    if (e instanceof AppError) return fail(e.message);
    if (e instanceof z.ZodError) {
      return fail(e.issues.map((i) => i.message).join(' '));
    }
    console.error('[billing/record-uploaded-invoice] failed:', e);
    return fail('Something went wrong recording the invoice. Please try again.');
  }
}

/* -------------------------------------------------------------------------- */
/* Uploaded invoice documents not yet recorded in the books                   */
/* -------------------------------------------------------------------------- */

export type UnrecordedInvoiceDocument = {
  documentId: string;
  title: string | null;
  originalFilename: string | null;
  uploadedAt: string;
};

/**
 * Client `invoice`-kind documents that were uploaded (from the Documents tab
 * or the Invoices-tab uploader) but never promoted to a real invoice — i.e.
 * no LIVE invoice has this file as its `sourceDocumentId`. These are surfaced
 * in the Invoices tab as "uploaded, not in books" so they stop being invisible
 * there, and can be recorded via {@link recordUploadedClientInvoice} once the
 * client is billing-ready.
 */
export async function listUnrecordedClientInvoiceDocuments(
  clientId: string,
): Promise<readonly UnrecordedInvoiceDocument[]> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'create_invoice');
  const cid = z.string().uuid().parse(clientId);

  const rows = await db
    .select({
      documentId: entityDocuments.documentId,
      title: entityDocuments.title,
      originalFilename: documents.originalFilename,
      createdAt: entityDocuments.createdAt,
    })
    .from(entityDocuments)
    .innerJoin(documents, eq(documents.id, entityDocuments.documentId))
    // Left-join any LIVE invoice built around this file; keep only the docs
    // that matched none. A doc linked solely to a soft-deleted invoice is
    // re-recordable, so it still counts as unrecorded.
    .leftJoin(
      invoices,
      and(eq(invoices.sourceDocumentId, entityDocuments.documentId), isNull(invoices.deletedAt)),
    )
    .where(
      and(
        eq(entityDocuments.entityType, 'client'),
        eq(entityDocuments.entityId, cid),
        eq(entityDocuments.kind, 'invoice'),
        eq(entityDocuments.status, 'active'),
        isNull(entityDocuments.deletedAt),
        isNull(documents.deletedAt),
        isNull(invoices.id),
      ),
    )
    .orderBy(desc(entityDocuments.createdAt));

  return rows.map((r) => ({
    documentId: r.documentId,
    title: r.title,
    originalFilename: r.originalFilename,
    uploadedAt: r.createdAt.toISOString(),
  }));
}
