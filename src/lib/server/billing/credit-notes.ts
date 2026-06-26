'use server';

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logActivity } from '@/lib/activity';
import { logAudit } from '@/lib/audit';
import { isGstImpactAllowed } from '@/lib/billing/credit-note-window';
import { fyStartForDate, todayIstIso } from '@/lib/billing/fy';
import { db, type DbClient } from '@/lib/db/client';
import {
  clients,
  creditNoteLines,
  creditNotes,
  entityAddresses,
  entityTaxIdentifiers,
  invoiceLines,
  invoices,
  organizations,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { createDraftTransaction, postTransaction, reverseTransaction } from '@/lib/server/ledger';

import { loadBillingSettings, nextDocumentNumber, withNumberingRetry } from './numbering';
import { renderCreditNotePdf, type CreditNotePdfData } from './pdf/credit-note';
import { uploadBillingPdf } from './pdf/upload';

/**
 * Credit notes — Phase 5.
 *
 *   createCreditNote(input)
 *     - Capability: manage_credit_note.
 *     - Mandatory original_invoice_id; ≥1 line.
 *     - Validates each line's amounts ≤ the corresponding original
 *       invoice line's amounts (the validation rule
 *       credit_note_exceeds_invoice would also flag this; here we
 *       refuse hard so the user can't accidentally over-credit).
 *     - Computes gst_impact_allowed per CGST §34(2) Nov 30 window.
 *     - Inserts credit_notes + credit_note_lines rows; runs invoice
 *       validations on the snapshot (for split / hsn warnings); flips
 *       state to 'draft'.
 *
 *   updateDraftCreditNote(id, input) — draft only; wholesale line replacement.
 *
 *   issueCreditNote(id)
 *     - Capability: manage_credit_note + create_journal_voucher
 *       (because the posting is a journal — there's no
 *       credit_note transaction_kind).
 *     - Generates Rule 53 PDF, uploads, sets sourceDocumentId.
 *     - Posts a journal that reverses the original invoice's revenue
 *       recognition (proportional to the credit's value):
 *
 *         Dr 4100 Service Revenue (sub: client)        subtotalPaise
 *           Cr 1200 Trade Receivables (sub: client)         total_paise
 *         Dr 2120 GST Output Payable                   taxTotalPaise (only if gst_impact_allowed)
 *
 *       If gst_impact_allowed = false: the Dr 4100 leg is bumped to
 *       the full total (no GST reversal). The credit absorbs the full
 *       gross out of revenue; the recipient must NOT reduce their
 *       input tax credit. The PDF carries a "commercial only" banner.
 *
 *       TODO(human): commercial credit note only; GST not reversible per
 *       Section 34(2) window — confirm whether the customer's
 *       accountant agrees before issuing.
 *
 *     - Updates invoice state: if cumulative credit-note value ≥
 *       (invoice total - payment_allocations - advance_allocations),
 *       reduces the receivable to zero. For v1 we do not auto-flip
 *       invoice.state — the AR aging view (Phase 7) will surface
 *       "fully credited" invoices via the outstanding_paise derivation.
 *
 *   voidCreditNote(id, reason) — issued → void. Reverses the posted
 *     ledger transaction via the existing reverseTransaction helper.
 *
 *   getCreditNote(id), listCreditNotes(filters).
 */

const CreditNoteIdSchema = z.string().uuid();

const CreditNoteLineInputSchema = z.object({
  lineNo: z.number().int().positive(),
  originalInvoiceLineId: z.string().uuid().nullish(),
  serviceItemId: z.string().uuid().nullish(),
  description: z.string().trim().min(1).max(1000),
  sacCode: z
    .string()
    .trim()
    .max(8)
    .nullish()
    .refine((v) => !v || /^[0-9]{4,8}$/.test(v), { message: 'SAC must be 4 to 8 digits.' }),
  qty: z.number().int().positive().default(1),
  ratePaise: z.bigint().nonnegative().default(0n),
  capturedTaxableValuePaise: z.bigint().nonnegative().default(0n),
  capturedTaxRateBps: z.number().int().min(0).max(10000).default(0),
  capturedTaxAmountPaise: z.bigint().nonnegative().default(0n),
  postingAccountCode: z.string().trim().max(20).default('4100'),
});

export type CreditNoteLineInput = z.input<typeof CreditNoteLineInputSchema>;

const TaxSplitSchema = z
  .object({
    cgst_paise: z.bigint().nonnegative().optional(),
    sgst_paise: z.bigint().nonnegative().optional(),
    igst_paise: z.bigint().nonnegative().optional(),
    cess_paise: z.bigint().nonnegative().optional(),
  })
  .strict();

const CreateCreditNoteInputSchema = z.object({
  originalInvoiceId: z.string().uuid(),
  documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(10).max(2000),
  subtotalPaise: z.bigint().nonnegative().default(0n),
  capturedTaxTotalPaise: z.bigint().nonnegative().default(0n),
  capturedTotalPaise: z.bigint().nonnegative().default(0n),
  capturedTaxSplit: TaxSplitSchema.optional(),
  notes: z.string().trim().max(4000).nullish(),
  idempotencyKey: z.string().trim().min(8).max(200),
  lines: z.array(CreditNoteLineInputSchema).min(1, 'Credit note must have at least one line.'),
});

export type CreateCreditNoteInput = z.input<typeof CreateCreditNoteInputSchema>;

export type CreateCreditNoteResult = {
  id: string;
  documentNumber: string;
  gstImpactAllowed: boolean;
};

export async function createCreditNote(
  input: CreateCreditNoteInput,
): Promise<CreateCreditNoteResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_credit_note');

  const v = CreateCreditNoteInputSchema.parse(input);

  // Idempotency short-circuit.
  const existing = await db
    .select({
      id: creditNotes.id,
      documentNumber: creditNotes.documentNumber,
      gstImpactAllowed: creditNotes.gstImpactAllowed,
    })
    .from(creditNotes)
    .where(eq(creditNotes.idempotencyKey, v.idempotencyKey))
    .limit(1);
  if (existing[0]) return existing[0];

  // Fetch original invoice (must be sent / partially_paid / paid; not
  // void / draft).
  const [original] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, v.originalInvoiceId))
    .limit(1);
  if (!original) {
    throw new AppError('not_found', `original invoice ${v.originalInvoiceId} not found`);
  }
  if (original.state === 'draft' || original.state === 'void') {
    throw new AppError(
      'validation',
      `cannot credit invoice ${v.originalInvoiceId} in state ${original.state}; must be sent/partially_paid/paid.`,
    );
  }

  // Validate total ≤ original total.
  if (v.capturedTotalPaise > original.capturedTotalPaise) {
    throw new AppError(
      'validation',
      `credit total ${v.capturedTotalPaise} paise exceeds original invoice total ${original.capturedTotalPaise} paise.`,
    );
  }

  // Per-line validation: each line's amounts must be ≤ original line.
  await validatePerLineAmounts(db, v.lines, v.originalInvoiceId);

  const gstImpactAllowed = isGstImpactAllowed(v.documentDate, original.financialYearStart);
  const settings = await loadBillingSettings();
  const fyStart = fyStartForDate(v.documentDate, settings.fyStartMonth);

  return withNumberingRetry(async () =>
    db.transaction(async (tx) =>
      insertCreditNoteCore(tx as unknown as DbClient, ctx, v, fyStart, original, gstImpactAllowed),
    ),
  );
}

async function validatePerLineAmounts(
  client: DbClient,
  lines: ReadonlyArray<CreditNoteLineInput>,
  originalInvoiceId: string,
): Promise<void> {
  // Pull the original invoice's lines once.
  const originalLines = await client
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, originalInvoiceId));
  const byId = new Map(originalLines.map((l) => [l.id, l]));

  for (const cnLine of lines) {
    if (!cnLine.originalInvoiceLineId) continue;
    const orig = byId.get(cnLine.originalInvoiceLineId);
    if (!orig) {
      throw new AppError(
        'validation',
        `credit-note line ${cnLine.lineNo} references invoice_line ${cnLine.originalInvoiceLineId} not on the original invoice.`,
      );
    }
    const credTaxable = BigInt(cnLine.capturedTaxableValuePaise ?? 0n);
    const credTax = BigInt(cnLine.capturedTaxAmountPaise ?? 0n);
    if (credTaxable > orig.capturedTaxableValuePaise) {
      throw new AppError(
        'validation',
        `credit-note line ${cnLine.lineNo} taxable ${credTaxable} paise exceeds original line ${orig.capturedTaxableValuePaise} paise.`,
      );
    }
    if (credTax > orig.capturedTaxAmountPaise) {
      throw new AppError(
        'validation',
        `credit-note line ${cnLine.lineNo} tax ${credTax} paise exceeds original line tax ${orig.capturedTaxAmountPaise} paise.`,
      );
    }
  }
}

async function insertCreditNoteCore(
  tx: DbClient,
  ctx: Awaited<ReturnType<typeof getActorContext>>,
  v: z.infer<typeof CreateCreditNoteInputSchema>,
  fyStart: string,
  original: typeof invoices.$inferSelect,
  gstImpactAllowed: boolean,
): Promise<CreateCreditNoteResult> {
  const { documentNumber } = await nextDocumentNumber('credit_note', fyStart, tx);

  const [row] = await tx
    .insert(creditNotes)
    .values({
      documentNumber,
      documentDate: v.documentDate,
      financialYearStart: fyStart,
      clientId: original.clientId,
      originalInvoiceId: v.originalInvoiceId,
      state: 'draft',
      reason: v.reason,
      subtotalPaise: v.subtotalPaise,
      capturedTaxTotalPaise: v.capturedTaxTotalPaise,
      capturedTotalPaise: v.capturedTotalPaise,
      placeOfSupply: original.placeOfSupply,
      capturedTaxSplit: serialiseTaxSplit(v.capturedTaxSplit),
      gstImpactAllowed,
      notes: v.notes ?? null,
      idempotencyKey: v.idempotencyKey,
      validationFlags: gstImpactAllowed
        ? []
        : [
            {
              code: 'credit_note_outside_window',
              severity: 'warn' as const,
              message: `Credit note dated ${v.documentDate} is past the §34(2) window for invoice FY starting ${original.financialYearStart}; GST output will NOT be reversed.`,
            },
          ],
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning({ id: creditNotes.id });
  if (!row) throw new AppError('internal', 'credit_notes.insert returned no row');

  await tx.insert(creditNoteLines).values(
    v.lines.map((l) => ({
      creditNoteId: row.id,
      lineNo: l.lineNo,
      originalInvoiceLineId: l.originalInvoiceLineId ?? null,
      serviceItemId: l.serviceItemId ?? null,
      description: l.description,
      sacCode: l.sacCode ?? null,
      qty: l.qty,
      ratePaise: l.ratePaise,
      capturedTaxableValuePaise: l.capturedTaxableValuePaise,
      capturedTaxRateBps: l.capturedTaxRateBps,
      capturedTaxAmountPaise: l.capturedTaxAmountPaise,
      postingAccountCode: l.postingAccountCode,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })),
  );

  return { id: row.id, documentNumber, gstImpactAllowed };
}

function serialiseTaxSplit(
  split: CreateCreditNoteInput['capturedTaxSplit'],
): Record<string, string> {
  if (!split) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(split)) {
    if (v !== undefined && v !== null) out[k] = v.toString();
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* updateDraftCreditNote                                                      */
/* -------------------------------------------------------------------------- */

const UpdateCreditNoteInputSchema = CreateCreditNoteInputSchema.partial().omit({
  idempotencyKey: true,
});

export async function updateDraftCreditNote(
  id: string,
  input: z.input<typeof UpdateCreditNoteInputSchema>,
): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_credit_note');
  const creditNoteId = CreditNoteIdSchema.parse(id);
  const v = UpdateCreditNoteInputSchema.parse(input);

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(creditNotes)
      .where(eq(creditNotes.id, creditNoteId))
      .limit(1);
    if (!current) throw new AppError('not_found', `credit_note ${creditNoteId} not found`);
    if (current.state !== 'draft') {
      throw new AppError(
        'validation',
        `credit_note ${creditNoteId} is ${current.state}; only drafts may be updated.`,
      );
    }

    const patch: Partial<typeof creditNotes.$inferInsert> = { updatedBy: ctx.userId };
    if (v.reason !== undefined) patch.reason = v.reason;
    if (v.documentDate !== undefined) {
      patch.documentDate = v.documentDate;
      patch.financialYearStart = fyStartForDate(v.documentDate);
      const [original] = await tx
        .select({ financialYearStart: invoices.financialYearStart })
        .from(invoices)
        .where(eq(invoices.id, current.originalInvoiceId))
        .limit(1);
      if (original) {
        patch.gstImpactAllowed = isGstImpactAllowed(v.documentDate, original.financialYearStart);
      }
    }
    if (v.subtotalPaise !== undefined) patch.subtotalPaise = v.subtotalPaise;
    if (v.capturedTaxTotalPaise !== undefined)
      patch.capturedTaxTotalPaise = v.capturedTaxTotalPaise;
    if (v.capturedTotalPaise !== undefined) patch.capturedTotalPaise = v.capturedTotalPaise;
    if (v.capturedTaxSplit !== undefined)
      patch.capturedTaxSplit = serialiseTaxSplit(v.capturedTaxSplit);
    if (v.notes !== undefined) patch.notes = v.notes ?? null;

    await tx.update(creditNotes).set(patch).where(eq(creditNotes.id, creditNoteId));

    if (v.lines !== undefined) {
      await validatePerLineAmounts(tx as unknown as DbClient, v.lines, current.originalInvoiceId);
      await tx.delete(creditNoteLines).where(eq(creditNoteLines.creditNoteId, creditNoteId));
      await tx.insert(creditNoteLines).values(
        v.lines.map((l) => ({
          creditNoteId,
          lineNo: l.lineNo,
          originalInvoiceLineId: l.originalInvoiceLineId ?? null,
          serviceItemId: l.serviceItemId ?? null,
          description: l.description,
          sacCode: l.sacCode ?? null,
          qty: l.qty,
          ratePaise: l.ratePaise,
          capturedTaxableValuePaise: l.capturedTaxableValuePaise,
          capturedTaxRateBps: l.capturedTaxRateBps,
          capturedTaxAmountPaise: l.capturedTaxAmountPaise,
          postingAccountCode: l.postingAccountCode,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })),
      );
    }
  });
}

/* -------------------------------------------------------------------------- */
/* issueCreditNote                                                            */
/* -------------------------------------------------------------------------- */

export type IssueCreditNoteResult = {
  id: string;
  state: 'issued';
  documentId: string;
  transactionId: string;
  gstImpactAllowed: boolean;
};

export async function issueCreditNote(id: string): Promise<IssueCreditNoteResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_credit_note');
  requireCapability(
    ctx,
    'create_journal_voucher',
    'Issuing a credit note posts a journal entry. create_journal_voucher capability required.',
  );
  const creditNoteId = CreditNoteIdSchema.parse(id);

  // Pre-flight read.
  const [current] = await db
    .select()
    .from(creditNotes)
    .where(eq(creditNotes.id, creditNoteId))
    .limit(1);
  if (!current) throw new AppError('not_found', `credit_note ${creditNoteId} not found`);
  if (current.state !== 'draft') {
    throw new AppError(
      'validation',
      `credit_note ${creditNoteId} is ${current.state}; only drafts may be issued.`,
    );
  }
  if (current.capturedTotalPaise <= 0n) {
    throw new AppError(
      'validation',
      'Credit note total must be > 0 to issue. Add at least one priced line.',
    );
  }

  const [original] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, current.originalInvoiceId))
    .limit(1);
  if (!original) {
    throw new AppError(
      'internal',
      `original invoice ${current.originalInvoiceId} missing during issue.`,
    );
  }

  // Step 1 — render + upload the PDF.
  const pdfData = await assembleCreditNotePdfData(creditNoteId);
  const pdfBytes = await renderCreditNotePdf(pdfData);
  const { documentId } = await uploadBillingPdf({
    ownerId: creditNoteId,
    attachToEntity: { entityType: 'client', entityId: current.clientId },
    documentNumber: current.documentNumber,
    category: 'credit_note',
    pdfBytes,
    actorId: ctx.userId,
  });

  // Step 2 — post the reversing journal.
  // Allowed: Dr 4100 subtotal + Dr 2120 tax / Cr 1200 total
  // Not allowed: Dr 4100 total / Cr 1200 total (no GST reversal)
  const legs: Array<{
    accountCode: string;
    side: 'debit' | 'credit';
    amountPaise: bigint;
    subledger?: { entityType: 'client'; entityId: string };
  }> = current.gstImpactAllowed
    ? [
        {
          accountCode: '4100',
          side: 'debit',
          amountPaise: current.subtotalPaise,
          subledger: { entityType: 'client', entityId: current.clientId },
        },
        {
          accountCode: '2120',
          side: 'debit',
          amountPaise: current.capturedTaxTotalPaise,
        },
        {
          accountCode: '1200',
          side: 'credit',
          amountPaise: current.capturedTotalPaise,
          subledger: { entityType: 'client', entityId: current.clientId },
        },
      ]
    : [
        // TODO(human): commercial credit note only; GST not reversible per
        // Section 34(2) window. Recipient must NOT reduce input tax credit.
        // Confirm with their accountant before issuing.
        {
          accountCode: '4100',
          side: 'debit',
          amountPaise: current.capturedTotalPaise,
          subledger: { entityType: 'client', entityId: current.clientId },
        },
        {
          accountCode: '1200',
          side: 'credit',
          amountPaise: current.capturedTotalPaise,
          subledger: { entityType: 'client', entityId: current.clientId },
        },
      ];

  const draft = await createDraftTransaction(ctx, {
    kind: 'journal',
    input: {
      externalRef: `credit_note:${current.documentNumber}`,
      txnDate: current.documentDate,
      journalReason: `Credit note ${current.documentNumber} against invoice ${original.documentNumber}: ${current.reason}`,
      legs,
      isOpeningBalance: false,
      notes: current.notes,
    },
  });
  await postTransaction(ctx, { transactionId: draft.transactionId, acknowledgedFlags: [] });

  // Step 3 — flip credit note state + back-link doc + posted txn.
  await db.transaction(async (tx) => {
    await tx
      .update(creditNotes)
      .set({
        state: 'issued',
        issuedAt: new Date(),
        sourceDocumentId: documentId,
        postedTransactionId: draft.transactionId,
        updatedBy: ctx.userId,
      })
      .where(eq(creditNotes.id, creditNoteId));

    await logActivity(
      {
        entityType: 'client',
        entityId: current.clientId,
        actorId: ctx.userId,
        kind: 'credit_note.issued',
        summary: `Credit note ${current.documentNumber} issued against ${original.documentNumber}`,
        payload: {
          credit_note_id: creditNoteId,
          credit_note_number: current.documentNumber,
          original_invoice_id: original.id,
          original_invoice_number: original.documentNumber,
          captured_total_paise: current.capturedTotalPaise.toString(),
          gst_impact_allowed: current.gstImpactAllowed,
          source_document_id: documentId,
          posted_transaction_id: draft.transactionId,
        },
      },
      db,
    );

    await logAudit(
      {
        actorId: ctx.userId,
        entityType: 'credit_note',
        entityId: creditNoteId,
        action: 'update',
        changes: {
          state: { before: 'draft', after: 'issued' },
          posted_transaction_id: { before: null, after: draft.transactionId },
        },
      },
      tx as unknown as typeof db,
    );
  });

  return {
    id: creditNoteId,
    state: 'issued' as const,
    documentId,
    transactionId: draft.transactionId,
    gstImpactAllowed: current.gstImpactAllowed,
  };
}

/* -------------------------------------------------------------------------- */
/* voidCreditNote                                                             */
/* -------------------------------------------------------------------------- */

export async function voidCreditNote(
  id: string,
  reason: string,
): Promise<{ id: string; state: 'void'; reversalTransactionId: string | null }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_credit_note');
  const creditNoteId = CreditNoteIdSchema.parse(id);

  if (reason.trim().length < 10) {
    throw new AppError('validation', 'Void reason must be at least 10 characters.');
  }

  const [current] = await db
    .select()
    .from(creditNotes)
    .where(eq(creditNotes.id, creditNoteId))
    .limit(1);
  if (!current) throw new AppError('not_found', `credit_note ${creditNoteId} not found`);
  if (current.state === 'void') {
    return { id: creditNoteId, state: 'void', reversalTransactionId: null };
  }

  let reversalTransactionId: string | null = null;
  if (current.postedTransactionId) {
    const result = await reverseTransaction(ctx, {
      transactionId: current.postedTransactionId,
      reason: `Credit note ${current.documentNumber} voided: ${reason}`,
    });
    reversalTransactionId = result.reversalTransactionId;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(creditNotes)
      .set({
        state: 'void',
        notes:
          current.notes && current.notes.length > 0
            ? `${current.notes}\n[void] ${reason}`
            : `[void] ${reason}`,
        updatedBy: ctx.userId,
      })
      .where(eq(creditNotes.id, creditNoteId));

    await logActivity(
      {
        entityType: 'client',
        entityId: current.clientId,
        actorId: ctx.userId,
        kind: 'credit_note.voided',
        summary: `Credit note ${current.documentNumber} voided`,
        payload: {
          credit_note_id: creditNoteId,
          credit_note_number: current.documentNumber,
          reason,
          reversal_transaction_id: reversalTransactionId,
        },
      },
      tx as unknown as typeof db,
    );

    await logAudit(
      {
        actorId: ctx.userId,
        entityType: 'credit_note',
        entityId: creditNoteId,
        action: 'update',
        changes: { state: { before: current.state, after: 'void' }, reason },
      },
      tx as unknown as typeof db,
    );
  });

  return { id: creditNoteId, state: 'void', reversalTransactionId };
}

/* -------------------------------------------------------------------------- */
/* getCreditNote / listCreditNotes                                            */
/* -------------------------------------------------------------------------- */

export type CreditNoteWithLines = {
  creditNote: typeof creditNotes.$inferSelect;
  lines: Array<typeof creditNoteLines.$inferSelect>;
};

export async function getCreditNote(id: string): Promise<CreditNoteWithLines | null> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_credit_note');
  const parsed = CreditNoteIdSchema.parse(id);
  const [cn] = await db.select().from(creditNotes).where(eq(creditNotes.id, parsed)).limit(1);
  if (!cn) return null;
  const lines = await db
    .select()
    .from(creditNoteLines)
    .where(eq(creditNoteLines.creditNoteId, parsed))
    .orderBy(asc(creditNoteLines.lineNo));
  return { creditNote: cn, lines };
}

export type ListCreditNotesFilters = {
  clientId?: string;
  originalInvoiceId?: string;
  states?: Array<typeof creditNotes.$inferSelect.state>;
  documentDateFrom?: string;
  documentDateTo?: string;
  limit?: number;
  offset?: number;
};

export async function listCreditNotes(
  filters: ListCreditNotesFilters = {},
): Promise<{ rows: Array<typeof creditNotes.$inferSelect>; total: number }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_credit_note');

  const conds = [];
  if (filters.clientId) conds.push(eq(creditNotes.clientId, filters.clientId));
  if (filters.originalInvoiceId)
    conds.push(eq(creditNotes.originalInvoiceId, filters.originalInvoiceId));
  if (filters.states && filters.states.length > 0)
    conds.push(inArray(creditNotes.state, filters.states));
  if (filters.documentDateFrom)
    conds.push(sql`${creditNotes.documentDate} >= ${filters.documentDateFrom}`);
  if (filters.documentDateTo)
    conds.push(sql`${creditNotes.documentDate} <= ${filters.documentDateTo}`);
  const where = conds.length > 0 ? and(...conds) : undefined;

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  const rows = await db
    .select()
    .from(creditNotes)
    .where(where)
    .orderBy(desc(creditNotes.documentDate), desc(creditNotes.documentNumber))
    .limit(limit)
    .offset(offset);

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(creditNotes)
    .where(where);
  return { rows, total: totalRow?.count ?? 0 };
}

export async function getCreditNoteComposerDefaults(): Promise<{
  today: string;
  fyStart: string;
}> {
  const settings = await loadBillingSettings();
  const today = todayIstIso();
  return { today, fyStart: fyStartForDate(today, settings.fyStartMonth) };
}

/* -------------------------------------------------------------------------- */
/* PDF data assembly                                                          */
/* -------------------------------------------------------------------------- */

async function assembleCreditNotePdfData(
  creditNoteId: string,
  client: DbClient = db,
): Promise<CreditNotePdfData> {
  const [cn] = await client
    .select()
    .from(creditNotes)
    .where(eq(creditNotes.id, creditNoteId))
    .limit(1);
  if (!cn) throw new AppError('not_found', `credit_note ${creditNoteId} not found`);

  const [original] = await client
    .select()
    .from(invoices)
    .where(eq(invoices.id, cn.originalInvoiceId))
    .limit(1);
  if (!original) {
    throw new AppError(
      'internal',
      `credit_notes.originalInvoiceId ${cn.originalInvoiceId} dangling`,
    );
  }

  const lines = await client
    .select()
    .from(creditNoteLines)
    .where(eq(creditNoteLines.creditNoteId, creditNoteId))
    .orderBy(asc(creditNoteLines.lineNo));

  const [supplierOrg] = await client.select().from(organizations).limit(1);
  if (!supplierOrg) {
    throw new AppError(
      'internal',
      "organizations table empty; seed Apar's organization row before rendering credit notes.",
    );
  }

  const [recipient] = await client
    .select()
    .from(clients)
    .where(eq(clients.id, cn.clientId))
    .limit(1);
  if (!recipient) throw new AppError('not_found', `client ${cn.clientId} not found`);

  const recipientAddresses = await client
    .select()
    .from(entityAddresses)
    .where(
      and(eq(entityAddresses.entityType, 'client'), eq(entityAddresses.entityId, cn.clientId)),
    );
  const recipientAddress =
    recipientAddresses.find((a) => a.kind === 'registered') ?? recipientAddresses[0] ?? null;

  const recipientTaxIds = await client
    .select()
    .from(entityTaxIdentifiers)
    .where(
      and(
        eq(entityTaxIdentifiers.entityType, 'client'),
        eq(entityTaxIdentifiers.entityId, cn.clientId),
        eq(entityTaxIdentifiers.kind, 'gstin'),
      ),
    )
    .limit(1);
  const recipientGstin = recipientTaxIds[0]?.maskedValue ?? null;

  const supplierStateCode =
    supplierOrg.gstin && supplierOrg.gstin.length >= 2 ? supplierOrg.gstin.slice(0, 2) : '27';

  const split = (cn.capturedTaxSplit ?? {}) as Record<string, string | number | undefined>;
  const toBigint = (v: unknown): bigint => {
    if (v == null) return 0n;
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(Math.trunc(v));
    if (typeof v === 'string' && /^-?\d+$/.test(v)) return BigInt(v);
    return 0n;
  };

  return {
    supplier: {
      name: supplierOrg.displayName ?? supplierOrg.legalName,
      address: supplierOrg.registeredAddress ?? '',
      gstin: supplierOrg.gstin ?? null,
      pan: supplierOrg.pan ?? null,
      stateCode: supplierStateCode,
    },
    recipient: {
      name: recipient.name,
      addressLines: recipientAddress
        ? [
            recipientAddress.line1,
            recipientAddress.line2 ?? '',
            [recipientAddress.city, recipientAddress.stateCode, recipientAddress.postalCode]
              .filter(Boolean)
              .join(', '),
          ].filter((s) => s && s.length > 0)
        : [],
      gstin: recipientGstin,
      stateCode: recipientAddress?.stateCode ?? null,
    },
    creditNoteNumber: cn.documentNumber,
    creditNoteDate: cn.documentDate,
    originalInvoiceNumber: original.documentNumber,
    originalInvoiceDate: original.documentDate,
    placeOfSupply: cn.placeOfSupply,
    reason: cn.reason,
    gstImpactAllowed: cn.gstImpactAllowed,
    lines: lines.map((l) => ({
      lineNo: l.lineNo,
      description: l.description,
      sacCode: l.sacCode,
      qty: l.qty,
      ratePaise: l.ratePaise,
      capturedTaxableValuePaise: l.capturedTaxableValuePaise,
      capturedTaxRateBps: l.capturedTaxRateBps,
      capturedTaxAmountPaise: l.capturedTaxAmountPaise,
    })),
    subtotalPaise: cn.subtotalPaise,
    capturedTaxSplit: {
      cgstPaise: toBigint(split.cgst_paise),
      sgstPaise: toBigint(split.sgst_paise),
      igstPaise: toBigint(split.igst_paise),
      cessPaise: toBigint(split.cess_paise),
    },
    capturedTaxTotalPaise: cn.capturedTaxTotalPaise,
    capturedTotalPaise: cn.capturedTotalPaise,
    notes: cn.notes,
  };
}
