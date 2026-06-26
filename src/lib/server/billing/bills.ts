'use server';

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logActivity } from '@/lib/activity';
import { logAudit } from '@/lib/audit';
import { fyStartForDate, todayIstIso } from '@/lib/billing/fy';
import { db, type DbClient } from '@/lib/db/client';
import { billLines, bills } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { createDraftTransaction, postTransaction, reverseTransaction } from '@/lib/server/ledger';
import type { VendorBillInput } from '@/lib/server/ledger/postings/vendorBill';
import { isValidTdsSection, type TdsSection } from '@/lib/validators';

import { loadBillingSettings } from './numbering';

/**
 * Vendor bills — Phase 6.
 *
 *   Wraps the existing vendor_bill posting template at
 *   lib/server/ledger/postings/vendorBill.ts, which already enforces
 *   the §0.6 attribution discipline (refuses without 'client' | 'opex'
 *   | 'asset'). This server-actions layer adds:
 *
 *     - bills + bill_lines persistence so the dashboard has a
 *       structured object to edit before posting (not just a free-form
 *       extraction blob)
 *     - draft state for the "still entering" period
 *     - recordBill which atomically posts the ledger txn + flips
 *       state draft → recorded + back-links postedTransactionId +
 *       updates document_id (the vendor's PDF, uploaded by the caller
 *       before posting)
 *     - voidBill which reverses the ledger txn (issued only)
 *
 *   Numbering: bills use the VENDOR's invoice number (not Apar's
 *   sequence). Unique-per-vendor enforced by
 *   bills_vendor_document_number_unique.
 */

const BillIdSchema = z.string().uuid();

const BillLineInputSchema = z.object({
  lineNo: z.number().int().positive(),
  description: z.string().trim().min(1).max(1000),
  sacCode: z.string().trim().max(8).nullish(),
  qty: z.number().int().positive().default(1),
  ratePaise: z.bigint().nonnegative().default(0n),
  capturedTaxableValuePaise: z.bigint().nonnegative().default(0n),
  capturedTaxRateBps: z.number().int().min(0).max(10000).default(0),
  capturedTaxAmountPaise: z.bigint().nonnegative().default(0n),
  postingAccountCode: z.string().trim().min(1).max(20),
});

export type BillLineInput = z.input<typeof BillLineInputSchema>;

const TaxSplitSchema = z
  .object({
    cgst_paise: z.bigint().nonnegative().optional(),
    sgst_paise: z.bigint().nonnegative().optional(),
    igst_paise: z.bigint().nonnegative().optional(),
    cess_paise: z.bigint().nonnegative().optional(),
  })
  .strict();

const AttributionBranchSchema = z.discriminatedUnion('attribution', [
  z.object({
    attribution: z.literal('client'),
    onBehalfOfClientId: z.string().uuid(),
    projectId: z.string().uuid().nullish(),
    opexAccountCode: z.never().optional(),
  }),
  z.object({
    attribution: z.literal('opex'),
    onBehalfOfClientId: z.never().optional(),
    projectId: z.string().uuid().nullish(),
    opexAccountCode: z.enum(['6100', '6200', '6300', '6400', '6600', '6900', '8100']),
  }),
  z.object({
    attribution: z.literal('asset'),
    onBehalfOfClientId: z.never().optional(),
    projectId: z.string().uuid().nullish(),
    opexAccountCode: z.never().optional(),
  }),
]);

const CreateBillInputSchema = z
  .object({
    vendorId: z.string().uuid(),
    /** Vendor's own invoice number — unique per vendor in our system. */
    documentNumber: z.string().trim().min(1).max(120),
    documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullish(),
    subtotalPaise: z.bigint().nonnegative().default(0n),
    capturedTaxTotalPaise: z.bigint().nonnegative().default(0n),
    capturedTotalPaise: z.bigint().nonnegative().default(0n),
    placeOfSupply: z
      .string()
      .trim()
      .nullish()
      .refine((v) => !v || /^[0-9]{2}$/.test(v), {
        message: 'placeOfSupply must be a 2-digit state code.',
      }),
    capturedTaxSplit: TaxSplitSchema.optional(),
    /** USER-ENTERED TDS (never computed). */
    capturedTdsAmountPaise: z.bigint().nonnegative().default(0n),
    capturedTdsSection: z.string().trim().max(20).nullish(),
    capturedTdsRateBps: z.number().int().min(0).max(10000).default(0),
    isRcm: z.boolean().default(false),
    /** Caller must have uploaded the vendor PDF first and pass its document.id. */
    sourceDocumentId: z.string().uuid(),
    notes: z.string().trim().max(4000).nullish(),
    idempotencyKey: z.string().trim().min(8).max(200),
    lines: z.array(BillLineInputSchema).min(1, 'Bill must have at least one line.'),
  })
  .and(AttributionBranchSchema);

export type CreateBillInput = z.input<typeof CreateBillInputSchema>;

export type CreateBillResult = { id: string };

export async function createDraftBill(input: CreateBillInput): Promise<CreateBillResult> {
  const ctx = await getActorContext();
  // Vendor bills don't have a dedicated capability in Phase 1.5; reuse
  // post_transaction since recording a vendor bill is fundamentally
  // accountant work and they hold that cap.
  requireCapability(ctx, 'post_transaction');

  const v = CreateBillInputSchema.parse(input);

  // Idempotency short-circuit.
  const existing = await db
    .select({ id: bills.id })
    .from(bills)
    .where(eq(bills.idempotencyKey, v.idempotencyKey))
    .limit(1);
  if (existing[0]) return { id: existing[0].id };

  const settings = await loadBillingSettings();
  const fyStart = fyStartForDate(v.documentDate, settings.fyStartMonth);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(bills)
      .values({
        documentNumber: v.documentNumber,
        documentDate: v.documentDate,
        dueDate: v.dueDate ?? null,
        financialYearStart: fyStart,
        vendorId: v.vendorId,
        attribution: v.attribution,
        onBehalfOfClientId: v.attribution === 'client' ? v.onBehalfOfClientId : null,
        projectId: v.projectId ?? null,
        opexAccountCode: v.attribution === 'opex' ? v.opexAccountCode : null,
        state: 'draft',
        subtotalPaise: v.subtotalPaise,
        capturedTaxTotalPaise: v.capturedTaxTotalPaise,
        capturedTotalPaise: v.capturedTotalPaise,
        placeOfSupply: v.placeOfSupply ?? null,
        capturedTaxSplit: serialiseTaxSplit(v.capturedTaxSplit),
        capturedTdsAmountPaise: v.capturedTdsAmountPaise,
        capturedTdsSection: v.capturedTdsSection ?? null,
        capturedTdsRateBps: v.capturedTdsRateBps,
        isRcm: v.isRcm,
        notes: v.notes ?? null,
        idempotencyKey: v.idempotencyKey,
        sourceDocumentId: v.sourceDocumentId,
        validationFlags: [],
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: bills.id });
    if (!row) throw new AppError('internal', 'bills.insert returned no row');

    await tx.insert(billLines).values(
      v.lines.map((l) => ({
        billId: row.id,
        lineNo: l.lineNo,
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

    return { id: row.id };
  });
}

type TaxSplit = {
  cgst_paise?: bigint;
  sgst_paise?: bigint;
  igst_paise?: bigint;
  cess_paise?: bigint;
};

function serialiseTaxSplit(split: TaxSplit | undefined): Record<string, string> {
  if (!split) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(split)) {
    if (val !== undefined && val !== null) out[k] = (val as bigint).toString();
  }
  return out;
}

function resolveTdsSection(captured: string | null | undefined): TdsSection | undefined {
  if (!captured) return undefined;
  if (isValidTdsSection(captured)) return captured;
  // Captured a section code that doesn't match our enum (e.g. older
  // '194I-b' from Phase 1.3 seeds vs the canonical '194I_building'
  // here). Normalize the common variants; else surface as a validation
  // error so the user can fix the source.
  const normalised = captured
    .replace(/-/g, '_')
    .replace(/^194I_b$/i, '194I_building')
    .replace(/^194I_p$/i, '194I_plant');
  if (isValidTdsSection(normalised)) return normalised;
  throw new AppError(
    'validation',
    `Captured TDS section "${captured}" is not in the TDS_SECTIONS enum. Update the bill or extend lib/validators.ts.`,
  );
}

/* -------------------------------------------------------------------------- */
/* updateDraftBill                                                            */
/* -------------------------------------------------------------------------- */

const UpdateBillInputSchema = z
  .object({
    documentNumber: z.string().trim().min(1).max(120).optional(),
    documentDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullish(),
    subtotalPaise: z.bigint().nonnegative().optional(),
    capturedTaxTotalPaise: z.bigint().nonnegative().optional(),
    capturedTotalPaise: z.bigint().nonnegative().optional(),
    placeOfSupply: z.string().trim().nullish(),
    capturedTaxSplit: TaxSplitSchema.optional(),
    capturedTdsAmountPaise: z.bigint().nonnegative().optional(),
    capturedTdsSection: z.string().trim().max(20).nullish(),
    capturedTdsRateBps: z.number().int().min(0).max(10000).optional(),
    isRcm: z.boolean().optional(),
    notes: z.string().trim().max(4000).nullish(),
    lines: z.array(BillLineInputSchema).min(1).optional(),
  })
  .strict();

export async function updateDraftBill(
  id: string,
  input: z.input<typeof UpdateBillInputSchema>,
): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'post_transaction');
  const billId = BillIdSchema.parse(id);
  const v = UpdateBillInputSchema.parse(input);

  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(bills).where(eq(bills.id, billId)).limit(1);
    if (!current) throw new AppError('not_found', `bill ${billId} not found`);
    if (current.state !== 'draft') {
      throw new AppError(
        'validation',
        `bill ${billId} is ${current.state}; only drafts may be updated.`,
      );
    }

    const patch: Partial<typeof bills.$inferInsert> = { updatedBy: ctx.userId };
    if (v.documentNumber !== undefined) patch.documentNumber = v.documentNumber;
    if (v.documentDate !== undefined) {
      patch.documentDate = v.documentDate;
      patch.financialYearStart = fyStartForDate(v.documentDate);
    }
    if (v.dueDate !== undefined) patch.dueDate = v.dueDate ?? null;
    if (v.subtotalPaise !== undefined) patch.subtotalPaise = v.subtotalPaise;
    if (v.capturedTaxTotalPaise !== undefined)
      patch.capturedTaxTotalPaise = v.capturedTaxTotalPaise;
    if (v.capturedTotalPaise !== undefined) patch.capturedTotalPaise = v.capturedTotalPaise;
    if (v.placeOfSupply !== undefined) patch.placeOfSupply = v.placeOfSupply ?? null;
    if (v.capturedTaxSplit !== undefined)
      patch.capturedTaxSplit = serialiseTaxSplit(v.capturedTaxSplit);
    if (v.capturedTdsAmountPaise !== undefined)
      patch.capturedTdsAmountPaise = v.capturedTdsAmountPaise;
    if (v.capturedTdsSection !== undefined) patch.capturedTdsSection = v.capturedTdsSection ?? null;
    if (v.capturedTdsRateBps !== undefined) patch.capturedTdsRateBps = v.capturedTdsRateBps;
    if (v.isRcm !== undefined) patch.isRcm = v.isRcm;
    if (v.notes !== undefined) patch.notes = v.notes ?? null;

    await tx.update(bills).set(patch).where(eq(bills.id, billId));

    if (v.lines !== undefined) {
      await tx.delete(billLines).where(eq(billLines.billId, billId));
      await tx.insert(billLines).values(
        v.lines.map((l) => ({
          billId,
          lineNo: l.lineNo,
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
/* recordBill — draft → recorded; posts the ledger                            */
/* -------------------------------------------------------------------------- */

export type RecordBillResult = {
  id: string;
  state: 'recorded';
  transactionId: string;
  validationFlags: Array<{ code: string; severity: string; message: string }>;
};

export async function recordBill(id: string): Promise<RecordBillResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'post_transaction');
  const billId = BillIdSchema.parse(id);

  const [current] = await db.select().from(bills).where(eq(bills.id, billId)).limit(1);
  if (!current) throw new AppError('not_found', `bill ${billId} not found`);
  if (current.state !== 'draft') {
    throw new AppError(
      'validation',
      `bill ${billId} is ${current.state}; only drafts may be recorded.`,
    );
  }
  if (!current.sourceDocumentId) {
    throw new AppError('validation', 'Bill has no sourceDocumentId; upload the vendor PDF first.');
  }

  const lines = await db
    .select({
      description: billLines.description,
      capturedTaxableValuePaise: billLines.capturedTaxableValuePaise,
      capturedTaxAmountPaise: billLines.capturedTaxAmountPaise,
    })
    .from(billLines)
    .where(eq(billLines.billId, billId));
  if (lines.length === 0) {
    throw new AppError('validation', `bill ${billId} has no lines.`);
  }

  const lineItems = lines.map((l) => ({
    description: l.description,
    amountPaise: l.capturedTaxableValuePaise,
    gstAmountPaiseCaptured: l.capturedTaxAmountPaise,
  }));

  let templateInput: VendorBillInput;
  if (current.attribution === 'client') {
    if (!current.onBehalfOfClientId) {
      throw new AppError(
        'validation',
        `bill ${billId} attribution=client but onBehalfOfClientId is null.`,
      );
    }
    templateInput = {
      attribution: 'client',
      vendorId: current.vendorId,
      onBehalfOfClientId: current.onBehalfOfClientId,
      projectId: current.projectId ?? undefined,
      billDocumentId: current.sourceDocumentId,
      vendorInvoiceNumber: current.documentNumber,
      txnDate: current.documentDate,
      lineItems,
      tdsAmountPaise: current.capturedTdsAmountPaise,
      tdsSection: resolveTdsSection(current.capturedTdsSection),
      isRcm: current.isRcm,
      notes: current.notes,
    };
  } else if (current.attribution === 'opex') {
    if (!current.opexAccountCode) {
      throw new AppError(
        'validation',
        `bill ${billId} attribution=opex but opexAccountCode is null.`,
      );
    }
    templateInput = {
      attribution: 'opex',
      vendorId: current.vendorId,
      expenseAccountCode: current.opexAccountCode as
        | '6100'
        | '6200'
        | '6300'
        | '6400'
        | '6900'
        | '8100',
      billDocumentId: current.sourceDocumentId,
      vendorInvoiceNumber: current.documentNumber,
      txnDate: current.documentDate,
      lineItems,
      tdsAmountPaise: current.capturedTdsAmountPaise,
      tdsSection: resolveTdsSection(current.capturedTdsSection),
      isRcm: current.isRcm,
      notes: current.notes,
    };
  } else {
    // asset
    templateInput = {
      attribution: 'asset',
      vendorId: current.vendorId,
      billDocumentId: current.sourceDocumentId,
      vendorInvoiceNumber: current.documentNumber,
      txnDate: current.documentDate,
      lineItems,
      isRcm: current.isRcm,
      notes: current.notes,
    };
  }

  const draft = await createDraftTransaction(ctx, {
    kind: 'vendor_bill',
    input: templateInput,
  });

  // Auto-ack warn-severity flags (the dashboard surfaced them at
  // compose time; recording means the user has decided to proceed).
  const acknowledgedFlags = draft.validationFlags
    .filter((f) => f.severity === 'warn')
    .map((f) => f.code);
  await postTransaction(ctx, {
    transactionId: draft.transactionId,
    acknowledgedFlags,
  });

  await db.transaction(async (tx) => {
    await tx
      .update(bills)
      .set({
        state: 'recorded',
        recordedAt: new Date(),
        postedTransactionId: draft.transactionId,
        validationFlags: draft.validationFlags as unknown as object[],
        updatedBy: ctx.userId,
      })
      .where(eq(bills.id, billId));

    await logActivity(
      {
        entityType: 'vendor',
        entityId: current.vendorId,
        actorId: ctx.userId,
        kind: 'bill.recorded',
        summary: `Bill ${current.documentNumber} recorded (${current.attribution})`,
        payload: {
          bill_id: billId,
          vendor_document_number: current.documentNumber,
          attribution: current.attribution,
          captured_total_paise: current.capturedTotalPaise.toString(),
          posted_transaction_id: draft.transactionId,
          warn_flags: acknowledgedFlags,
        },
      },
      tx as unknown as typeof db,
    );

    await logAudit(
      {
        actorId: ctx.userId,
        entityType: 'bill',
        entityId: billId,
        action: 'update',
        changes: {
          state: { before: 'draft', after: 'recorded' },
          posted_transaction_id: { before: null, after: draft.transactionId },
        },
      },
      tx as unknown as typeof db,
    );
  });

  return {
    id: billId,
    state: 'recorded' as const,
    transactionId: draft.transactionId,
    validationFlags: draft.validationFlags,
  };
}

/* -------------------------------------------------------------------------- */
/* voidBill                                                                   */
/* -------------------------------------------------------------------------- */

export async function voidBill(
  id: string,
  reason: string,
): Promise<{ id: string; state: 'void'; reversalTransactionId: string | null }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'post_transaction');
  const billId = BillIdSchema.parse(id);

  if (reason.trim().length < 10) {
    throw new AppError('validation', 'Void reason must be at least 10 characters.');
  }

  const [current] = await db.select().from(bills).where(eq(bills.id, billId)).limit(1);
  if (!current) throw new AppError('not_found', `bill ${billId} not found`);
  if (current.state === 'void') {
    return { id: billId, state: 'void', reversalTransactionId: null };
  }
  if (current.state === 'paid') {
    throw new AppError(
      'validation',
      `bill ${billId} is already paid; reverse payments first or issue a credit note.`,
    );
  }

  let reversalTransactionId: string | null = null;
  if (current.postedTransactionId) {
    const result = await reverseTransaction(ctx, {
      transactionId: current.postedTransactionId,
      reason: `Bill ${current.documentNumber} voided: ${reason}`,
    });
    reversalTransactionId = result.reversalTransactionId;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(bills)
      .set({
        state: 'void',
        notes:
          current.notes && current.notes.length > 0
            ? `${current.notes}\n[void] ${reason}`
            : `[void] ${reason}`,
        updatedBy: ctx.userId,
      })
      .where(eq(bills.id, billId));

    await logActivity(
      {
        entityType: 'vendor',
        entityId: current.vendorId,
        actorId: ctx.userId,
        kind: 'bill.voided',
        summary: `Bill ${current.documentNumber} voided`,
        payload: {
          bill_id: billId,
          vendor_document_number: current.documentNumber,
          reason,
          reversal_transaction_id: reversalTransactionId,
        },
      },
      tx as unknown as typeof db,
    );

    await logAudit(
      {
        actorId: ctx.userId,
        entityType: 'bill',
        entityId: billId,
        action: 'update',
        changes: { state: { before: current.state, after: 'void' }, reason },
      },
      tx as unknown as typeof db,
    );
  });

  return { id: billId, state: 'void', reversalTransactionId };
}

/* -------------------------------------------------------------------------- */
/* getBill / listBills                                                        */
/* -------------------------------------------------------------------------- */

export type BillWithLines = {
  bill: typeof bills.$inferSelect;
  lines: Array<typeof billLines.$inferSelect>;
};

export async function getBill(id: string): Promise<BillWithLines | null> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'post_transaction');
  const parsed = BillIdSchema.parse(id);
  const [row] = await db.select().from(bills).where(eq(bills.id, parsed)).limit(1);
  if (!row) return null;
  const lines = await db
    .select()
    .from(billLines)
    .where(eq(billLines.billId, parsed))
    .orderBy(asc(billLines.lineNo));
  return { bill: row, lines };
}

export type ListBillsFilters = {
  vendorId?: string;
  onBehalfOfClientId?: string;
  projectId?: string;
  attribution?: 'client' | 'opex' | 'asset';
  states?: Array<typeof bills.$inferSelect.state>;
  documentDateFrom?: string;
  documentDateTo?: string;
  limit?: number;
  offset?: number;
};

export async function listBills(
  filters: ListBillsFilters = {},
): Promise<{ rows: Array<typeof bills.$inferSelect>; total: number }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'post_transaction');

  const conds = [];
  if (filters.vendorId) conds.push(eq(bills.vendorId, filters.vendorId));
  if (filters.onBehalfOfClientId)
    conds.push(eq(bills.onBehalfOfClientId, filters.onBehalfOfClientId));
  if (filters.projectId) conds.push(eq(bills.projectId, filters.projectId));
  if (filters.attribution) conds.push(eq(bills.attribution, filters.attribution));
  if (filters.states && filters.states.length > 0) conds.push(inArray(bills.state, filters.states));
  if (filters.documentDateFrom)
    conds.push(sql`${bills.documentDate} >= ${filters.documentDateFrom}`);
  if (filters.documentDateTo) conds.push(sql`${bills.documentDate} <= ${filters.documentDateTo}`);
  const where = conds.length > 0 ? and(...conds) : undefined;

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  const rows = await db
    .select()
    .from(bills)
    .where(where)
    .orderBy(desc(bills.documentDate), desc(bills.documentNumber))
    .limit(limit)
    .offset(offset);

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bills)
    .where(where);
  return { rows, total: totalRow?.count ?? 0 };
}

export async function getBillComposerDefaults(): Promise<{ today: string; fyStart: string }> {
  const settings = await loadBillingSettings();
  const today = todayIstIso();
  return { today, fyStart: fyStartForDate(today, settings.fyStartMonth) };
}
