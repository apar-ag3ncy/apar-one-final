'use server';

import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logActivity } from '@/lib/activity';
import { logAudit } from '@/lib/audit';
import { fyStartForDate } from '@/lib/billing/fy';
import { db, type DbClient } from '@/lib/db/client';
import {
  clients,
  customerAdvances,
  entityAddresses,
  entityTaxIdentifiers,
  organizations,
  receiptVouchers,
  receipts,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { createDraftTransaction, postTransaction } from '@/lib/server/ledger';

import { loadBillingSettings, nextDocumentNumber, withNumberingRetry } from './numbering';
import { renderReceiptVoucherPdf, type ReceiptVoucherPdfData } from './pdf/receipt-voucher';
import { renderRefundVoucherPdf } from './pdf/refund-voucher';
import { uploadBillingPdf } from './pdf/upload';
import { advanceAllocations, invoices, refundVouchers } from '@/lib/db/schema';

/**
 * Customer-advance receipt flow. Phase 4.6.
 *
 *   recordCustomerAdvance(input)
 *     - Capability: receive_payment.
 *     - Creates (in one DB tx):
 *         a) receipts row     (the inbound payment)
 *         b) receipt_vouchers row (the Rule 50 voucher)
 *         c) customer_advances row (linking the two, balance = advance)
 *     - Generates + uploads the Rule 50 receipt-voucher PDF, sets
 *       receipt_vouchers.sourceDocumentId.
 *     - Posts a single ledger transaction via the extended
 *       client_advance_received template:
 *         Dr 1120 Bank sub:bank          advancePaise
 *           Cr 2180 Client Advances sub:client   advancePaise
 *         Dr 1252 Advance-Output-GST-Asset       advanceTaxPaise (if > 0)
 *           Cr 2120 GST Output Payable           advanceTaxPaise (if > 0)
 *     - Logs advance.received.
 *
 *   Adjustment (Phase 4.7) and refund (Phase 4.8) live in the next
 *   commit; both reference the customer_advances + receipt_vouchers
 *   rows created here.
 */

const RecordCustomerAdvanceInputSchema = z.object({
  clientId: z.string().uuid(),
  /** 'bank' → 1120 (needs bankAccountId); 'cash' → 1110. Back-compat default 'bank'. */
  mode: z.enum(['bank', 'cash']).default('bank'),
  /** Our agency bank account (bank_accounts.id) — required when mode='bank', null for cash. */
  bankAccountId: z.string().uuid().nullish(),
  /** How the money arrived (NEFT/RTGS/IMPS/UPI/cheque) — bank mode only. */
  transferMethod: z.enum(['neft', 'rtgs', 'imps', 'upi', 'cheque']).nullish(),
  /** Cheque capture (0064) — required when transferMethod='cheque'. */
  chequeNumber: z.string().trim().max(40).nullish(),
  chequeDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Advance net amount (paise). Tax is on top of this. */
  advancePaise: z.bigint().positive(),
  /** Captured advance-stage GST. USER-ENTERED. 0n if no GST applies. */
  advanceTaxPaise: z.bigint().nonnegative().default(0n),
  advanceTaxRateBps: z.number().int().min(0).max(10000).default(1800),
  placeOfSupply: z
    .string()
    .trim()
    .nullish()
    .refine((v) => !v || /^[0-9]{2}$/.test(v), {
      message: 'placeOfSupply must be a 2-digit state code.',
    }),
  /** SAC code of the planned service the advance is against. */
  sacCode: z
    .string()
    .trim()
    .max(8)
    .nullish()
    .refine((v) => !v || /^[0-9]{4,8}$/.test(v), { message: 'SAC must be 4 to 8 digits.' }),
  /** Free-text description of the planned service (rendered on the voucher). */
  description: z.string().trim().max(2000).nullish(),
  /**
   * Receipt method written to receipts.method. Normally DERIVED server-side
   * from mode/transferMethod (see deriveReceiptMethod); this is only a
   * back-compat fallback for legacy callers that pass method directly and
   * omit mode/transferMethod.
   */
  method: z.enum(['bank_transfer', 'upi', 'cheque', 'card', 'cash']).default('bank_transfer'),
  notes: z.string().trim().max(2000).nullish(),
});

export type RecordCustomerAdvanceInput = z.input<typeof RecordCustomerAdvanceInputSchema>;

type ReceiptMethod = 'bank_transfer' | 'upi' | 'cheque' | 'card' | 'cash';

/**
 * Derive the receipts.method enum value from the payment mode + transfer
 * method — the receipts-table analogue of the Record-receipt path
 * (client-receipts.ts derives the PDF method the same way). Cash → 'cash';
 * cheque and UPI keep their dedicated enum members; NEFT/RTGS/IMPS collapse to
 * 'bank_transfer' (the enum has no dedicated members for them). Falls back to
 * `fallback` for a bank payment with no transfer method chosen.
 */
function deriveReceiptMethod(
  mode: 'bank' | 'cash',
  transferMethod: 'neft' | 'rtgs' | 'imps' | 'upi' | 'cheque' | null | undefined,
  fallback: ReceiptMethod,
): ReceiptMethod {
  if (mode === 'cash') return 'cash';
  if (transferMethod === 'cheque') return 'cheque';
  if (transferMethod === 'upi') return 'upi';
  if (transferMethod === 'neft' || transferMethod === 'rtgs' || transferMethod === 'imps') {
    return 'bank_transfer';
  }
  return fallback;
}

export type RecordCustomerAdvanceResult = {
  advanceId: string;
  receiptId: string;
  receiptVoucherId: string;
  voucherNumber: string;
  receiptVoucherDocumentId: string;
  transactionId: string;
};

export async function recordCustomerAdvance(
  input: RecordCustomerAdvanceInput,
): Promise<RecordCustomerAdvanceResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'receive_payment');

  const v = RecordCustomerAdvanceInputSchema.parse(input);
  // Same guards as recordClientReceipt (client-receipts.ts:102-107): a bank
  // advance needs the bank account; a cheque needs its number.
  if (v.mode === 'bank' && !v.bankAccountId) {
    throw new AppError('validation', 'Pick the bank account the money was received into.');
  }
  if (v.transferMethod === 'cheque' && !v.chequeNumber?.trim()) {
    throw new AppError('validation', 'Enter the cheque number.');
  }
  const settings = await loadBillingSettings();
  const fyStart = fyStartForDate(v.receiptDate, settings.fyStartMonth);
  const grossPaise = v.advancePaise + v.advanceTaxPaise;

  // Step 1 — allocate numbers + insert receipt + receipt_voucher +
  // customer_advances rows, post the ledger. All inside one DB tx so
  // they succeed-or-fail together.
  const ids = await withNumberingRetry(async () =>
    db.transaction(async (tx) =>
      insertAdvanceCore(tx as unknown as DbClient, ctx, v, fyStart, grossPaise),
    ),
  );

  // Step 2 — generate the Rule 50 voucher PDF (snapshot now that the
  // numbers exist), upload, back-link to receipt_vouchers.sourceDocumentId.
  const pdfData = await assembleVoucherPdfData(ids.receiptVoucherId, v.placeOfSupply ?? null);
  const pdfBytes = await renderReceiptVoucherPdf(pdfData);
  const { documentId } = await uploadBillingPdf({
    ownerId: ids.receiptVoucherId,
    attachToEntity: { entityType: 'client', entityId: v.clientId },
    documentNumber: ids.voucherNumber,
    category: 'receipt_voucher',
    pdfBytes,
    actorId: ctx.userId,
  });
  await db
    .update(receiptVouchers)
    .set({ sourceDocumentId: documentId, updatedBy: ctx.userId })
    .where(eq(receiptVouchers.id, ids.receiptVoucherId));

  return {
    advanceId: ids.advanceId,
    receiptId: ids.receiptId,
    receiptVoucherId: ids.receiptVoucherId,
    voucherNumber: ids.voucherNumber,
    receiptVoucherDocumentId: documentId,
    transactionId: ids.transactionId,
  };
}

async function insertAdvanceCore(
  tx: DbClient,
  ctx: Awaited<ReturnType<typeof getActorContext>>,
  v: z.infer<typeof RecordCustomerAdvanceInputSchema>,
  fyStart: string,
  grossPaise: bigint,
): Promise<{
  advanceId: string;
  receiptId: string;
  receiptVoucherId: string;
  voucherNumber: string;
  transactionId: string;
}> {
  // Allocate receipt + voucher numbers under their own FY sequences.
  const { documentNumber: receiptNumber } = await nextDocumentNumber('receipt', fyStart, tx);
  const { documentNumber: voucherNumber } = await nextDocumentNumber(
    'receipt_voucher',
    fyStart,
    tx,
  );

  // Derive the mode-aware receipt fields (mirror recordClientReceipt).
  const method = deriveReceiptMethod(v.mode, v.transferMethod, v.method);
  const isCheque = v.transferMethod === 'cheque';
  const chequeNumber = isCheque ? (v.chequeNumber?.trim() || null) : null;
  const chequeDate = isCheque ? (v.chequeDate ?? null) : null;
  // Cash advances hit 1110 (no bank sub-ledger) → no bankAccountId on the row.
  const receiptBankAccountId = v.mode === 'cash' ? null : (v.bankAccountId ?? null);

  // Cheque narration suffix — mirror client-receipts.ts:128-136. Appended to
  // the receipt row's notes AND the receipt_vouchers notes so it surfaces on
  // the Rule 50 voucher PDF (assembled from receipt_vouchers.notes).
  const chequeSuffix =
    isCheque && chequeNumber
      ? `Cheque #${chequeNumber}${chequeDate ? ` dt ${chequeDate}` : ''}`
      : null;
  const withSuffix = (base: string | null): string | null =>
    chequeSuffix ? (base?.trim() ? `${base.trim()} · ${chequeSuffix}` : chequeSuffix) : base;

  // a) receipts — total = gross (advance + tax) since that's what hit the bank.
  const [receiptRow] = await tx
    .insert(receipts)
    .values({
      receiptNumber,
      receiptDate: v.receiptDate,
      financialYearStart: fyStart,
      clientId: v.clientId,
      bankAccountId: receiptBankAccountId,
      totalPaise: grossPaise,
      method,
      chequeNumber,
      chequeDate,
      notes: withSuffix(v.notes ?? null) ?? 'Customer advance (Rule 50 voucher generated).',
      validationFlags: [],
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning({ id: receipts.id });
  if (!receiptRow) throw new AppError('internal', 'receipts.insert returned no row');

  // b) receipt_vouchers — Rule 50.
  const [voucherRow] = await tx
    .insert(receiptVouchers)
    .values({
      voucherNumber,
      voucherDate: v.receiptDate,
      financialYearStart: fyStart,
      clientId: v.clientId,
      advancePaise: v.advancePaise,
      taxPaise: v.advanceTaxPaise,
      taxRateBps: v.advanceTaxRateBps,
      placeOfSupply: v.placeOfSupply ?? null,
      sacCode: v.sacCode ?? null,
      notes: withSuffix(v.description ?? v.notes ?? null),
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning({ id: receiptVouchers.id });
  if (!voucherRow) throw new AppError('internal', 'receipt_vouchers.insert returned no row');

  // c) customer_advances — links the receipt + voucher, balance = advance.
  const [advanceRow] = await tx
    .insert(customerAdvances)
    .values({
      clientId: v.clientId,
      originalReceiptId: receiptRow.id,
      receiptVoucherId: voucherRow.id,
      advancePaise: v.advancePaise,
      advanceTaxPaise: v.advanceTaxPaise,
      advanceTaxRateBps: v.advanceTaxRateBps,
      balancePaise: v.advancePaise,
      notes: v.notes ?? null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning({ id: customerAdvances.id });
  if (!advanceRow) throw new AppError('internal', 'customer_advances.insert returned no row');

  // d) post the ledger transaction via the extended template.
  const draft = await createDraftTransaction(
    ctx,
    {
      kind: 'client_advance_received',
      input: {
        clientId: v.clientId,
        mode: v.mode,
        transferMethod: v.transferMethod ?? null,
        chequeNumber,
        chequeDate,
        bankAccountId: receiptBankAccountId,
        amountPaise: v.advancePaise,
        advanceTaxPaise: v.advanceTaxPaise,
        externalRef: `advance:${voucherNumber}`,
        txnDate: v.receiptDate,
        notes: v.notes ?? null,
      },
    },
    tx as unknown as typeof db,
  );
  await postTransaction(
    ctx,
    { transactionId: draft.transactionId, acknowledgedFlags: [] },
    tx as unknown as typeof db,
  );

  // Back-link the txn on receipts.
  await tx
    .update(receipts)
    .set({ postedTransactionId: draft.transactionId, updatedBy: ctx.userId })
    .where(eq(receipts.id, receiptRow.id));

  await logActivity(
    {
      entityType: 'client',
      entityId: v.clientId,
      actorId: ctx.userId,
      kind: 'advance.received',
      summary: `Advance ${voucherNumber} for ₹${v.advancePaise.toString()} paise (+ ₹${v.advanceTaxPaise.toString()} GST)`,
      payload: {
        advance_id: advanceRow.id,
        receipt_id: receiptRow.id,
        receipt_voucher_id: voucherRow.id,
        voucher_number: voucherNumber,
        receipt_number: receiptNumber,
        advance_paise: v.advancePaise.toString(),
        advance_tax_paise: v.advanceTaxPaise.toString(),
        posted_transaction_id: draft.transactionId,
      },
    },
    tx as unknown as typeof db,
  );

  await logAudit(
    {
      actorId: ctx.userId,
      entityType: 'customer_advance',
      entityId: advanceRow.id,
      action: 'insert',
      changes: {
        voucher_number: voucherNumber,
        advance_paise: v.advancePaise.toString(),
        advance_tax_paise: v.advanceTaxPaise.toString(),
      },
    },
    tx as unknown as typeof db,
  );

  return {
    advanceId: advanceRow.id,
    receiptId: receiptRow.id,
    receiptVoucherId: voucherRow.id,
    voucherNumber,
    transactionId: draft.transactionId,
  };
}

/* -------------------------------------------------------------------------- */
/* PDF data assembly — exported for reuse by 4.7/4.8                          */
/* -------------------------------------------------------------------------- */

export async function assembleVoucherPdfData(
  receiptVoucherId: string,
  placeOfSupplyOverride: string | null = null,
  client: DbClient = db,
): Promise<ReceiptVoucherPdfData> {
  const [voucher] = await client
    .select()
    .from(receiptVouchers)
    .where(eq(receiptVouchers.id, receiptVoucherId))
    .limit(1);
  if (!voucher) {
    throw new AppError('not_found', `receipt_voucher ${receiptVoucherId} not found`);
  }

  const [supplierOrg] = await client.select().from(organizations).limit(1);
  if (!supplierOrg) {
    throw new AppError(
      'internal',
      "organizations table empty; seed Apar's organization row before rendering vouchers.",
    );
  }

  const [recipient] = await client
    .select()
    .from(clients)
    .where(eq(clients.id, voucher.clientId))
    .limit(1);
  if (!recipient) throw new AppError('not_found', `client ${voucher.clientId} not found`);

  const recipientAddresses = await client
    .select()
    .from(entityAddresses)
    .where(eq(entityAddresses.entityId, voucher.clientId));
  const recipientAddress =
    recipientAddresses.find((a) => a.entityType === 'client' && a.kind === 'registered') ??
    recipientAddresses.find((a) => a.entityType === 'client') ??
    null;

  const recipientTaxIds = await client
    .select()
    .from(entityTaxIdentifiers)
    .where(eq(entityTaxIdentifiers.entityId, voucher.clientId))
    .limit(5);
  const recipientGstin =
    recipientTaxIds.find((t) => t.entityType === 'client' && t.kind === 'gstin')?.maskedValue ??
    null;

  const supplierStateCode =
    supplierOrg.gstin && supplierOrg.gstin.length >= 2 ? supplierOrg.gstin.slice(0, 2) : '27';
  const pos = placeOfSupplyOverride ?? voucher.placeOfSupply ?? null;
  const isIntraState =
    !!pos &&
    (pos === supplierStateCode ||
      // accept 2-letter state-abbrev match for legacy address rows
      (recipientAddress?.stateCode === pos && supplierStateCode === pos));

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
    voucherNumber: voucher.voucherNumber,
    voucherDate: voucher.voucherDate,
    placeOfSupply: pos,
    sacCode: voucher.sacCode,
    description: voucher.notes,
    advancePaise: voucher.advancePaise,
    taxPaise: voucher.taxPaise,
    taxRateBps: voucher.taxRateBps,
    isIntraState,
    isReverseCharge: false,
    notes: voucher.notes,
  };
}

/* -------------------------------------------------------------------------- */
/* Read helpers                                                               */
/* -------------------------------------------------------------------------- */

export async function getCustomerAdvance(
  id: string,
): Promise<typeof customerAdvances.$inferSelect | null> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'receive_payment');
  const parsedId = z.string().uuid().parse(id);
  const [row] = await db
    .select()
    .from(customerAdvances)
    .where(eq(customerAdvances.id, parsedId))
    .limit(1);
  return row ?? null;
}

export async function listCustomerAdvances(filters?: {
  clientId?: string;
  withBalance?: boolean;
}): Promise<Array<typeof customerAdvances.$inferSelect>> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'receive_payment');
  const conds = [];
  if (filters?.clientId) conds.push(eq(customerAdvances.clientId, filters.clientId));
  // SQL-side `balance_paise > 0` would be tighter; the trigger keeps it in sync.
  const rows = await db
    .select()
    .from(customerAdvances)
    .where(conds.length > 0 ? conds[0] : undefined);
  return filters?.withBalance ? rows.filter((r) => r.balancePaise > 0n) : rows;
}

/* -------------------------------------------------------------------------- */
/* Phase 4.7 — adjustAdvanceToInvoice                                         */
/* -------------------------------------------------------------------------- */

/**
 * Apply `amountPaise` of a customer advance to an invoice. Inserts
 * an advance_allocations row (the Phase 1 trigger keeps
 * customer_advances.balance_paise in sync and enforces the per-advance
 * sum constraint).
 *
 * Posts a journal that unwinds the Rule 50 accrual proportionally:
 *
 *   Dr  2180 Client Advances Received (sub: client)   amountPaise
 *     Cr  1200 Trade Receivables (sub: client)              amountPaise
 *   Dr  2120 GST Output Payable                       gstUnwindPaise
 *     Cr  1252 Advance-Output-GST-Asset                     gstUnwindPaise
 *
 * gstUnwindPaise = advance.advanceTaxPaise * amountPaise / advance.advancePaise
 * (integer bigint division — truncates the half-paise; matches every
 * other money flow in the system).
 *
 * Captured-not-computed note: this isn't deriving GST from a rate, it's
 * apportioning a captured tax amount proportionally to a captured
 * advance amount — a pure bookkeeping unwind. Documented inline.
 *
 * Updates the invoice's state if cumulative settlement (allocations +
 * payment_allocations) crosses captured_total_paise: → 'paid';
 * otherwise → 'partially_paid'.
 */
export type AdjustAdvanceResult = {
  advanceAllocationId: string;
  appliedPaise: bigint;
  gstUnwoundPaise: bigint;
  invoiceState: typeof invoices.$inferSelect.state | null;
  transactionId: string;
};

export async function adjustAdvanceToInvoice(args: {
  advanceId: string;
  invoiceId: string;
  amountPaise: bigint;
}): Promise<AdjustAdvanceResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'receive_payment');
  // Journal kind also requires create_journal_voucher; accountant/admin/
  // partner have it per Phase 1 seeds. Surface a clearer error if not.
  requireCapability(
    ctx,
    'create_journal_voucher',
    'Adjusting an advance to an invoice posts a journal entry (Dr 2180 / Cr 1200 + Dr 2120 / Cr 1252). create_journal_voucher capability required.',
  );

  const advanceId = z.string().uuid().parse(args.advanceId);
  const invoiceId = z.string().uuid().parse(args.invoiceId);
  const amount = z.bigint().positive().parse(args.amountPaise);

  return db.transaction(async (tx) => {
    const [advance] = await tx
      .select()
      .from(customerAdvances)
      .where(eq(customerAdvances.id, advanceId))
      .limit(1);
    if (!advance) throw new AppError('not_found', `customer_advance ${advanceId} not found`);

    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!invoice) throw new AppError('not_found', `invoice ${invoiceId} not found`);
    if (invoice.clientId !== advance.clientId) {
      throw new AppError(
        'validation',
        `advance.clientId (${advance.clientId}) != invoice.clientId (${invoice.clientId}); cannot adjust across clients.`,
      );
    }
    if (invoice.state === 'draft' || invoice.state === 'void') {
      throw new AppError(
        'validation',
        `invoice ${invoiceId} is ${invoice.state}; advances can only be applied to sent / partially_paid invoices.`,
      );
    }
    if (advance.balancePaise < amount) {
      throw new AppError(
        'validation',
        `advance balance ${advance.balancePaise} paise < requested ${amount} paise.`,
      );
    }

    // Proportional GST unwind.
    const gstUnwindPaise =
      advance.advanceTaxPaise === 0n || advance.advancePaise === 0n
        ? 0n
        : (advance.advanceTaxPaise * amount) / advance.advancePaise;

    // Insert allocation row — the Phase 1 trigger refreshes
    // customer_advances.balance_paise + enforces the sum constraint.
    const [allocRow] = await tx
      .insert(advanceAllocations)
      .values({
        advanceId,
        invoiceId,
        allocatedPaise: amount,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: advanceAllocations.id });
    if (!allocRow) {
      throw new AppError('internal', 'advance_allocations.insert returned no row');
    }

    // Post the unwind journal.
    const legs: Array<{
      accountCode: string;
      side: 'debit' | 'credit';
      amountPaise: bigint;
      subledger?: {
        entityType: 'client' | 'vendor' | 'employee' | 'project' | 'office';
        entityId: string;
      };
    }> = [
      {
        accountCode: '2180',
        side: 'debit',
        amountPaise: amount,
        subledger: { entityType: 'client', entityId: advance.clientId },
      },
      {
        accountCode: '1200',
        side: 'credit',
        amountPaise: amount,
        subledger: { entityType: 'client', entityId: advance.clientId },
      },
    ];
    if (gstUnwindPaise > 0n) {
      legs.push({ accountCode: '2120', side: 'debit', amountPaise: gstUnwindPaise });
      legs.push({ accountCode: '1252', side: 'credit', amountPaise: gstUnwindPaise });
    }

    const draft = await createDraftTransaction(
      ctx,
      {
        kind: 'journal',
        input: {
          externalRef: `advance_adjustment:${allocRow.id}`,
          txnDate: new Date().toISOString().slice(0, 10),
          journalReason: `Apply advance ${advanceId} to invoice ${invoice.documentNumber} (₹${amount.toString()} paise + ₹${gstUnwindPaise.toString()} GST unwind)`,
          legs,
          isOpeningBalance: false,
          notes: null,
        },
      },
      tx as unknown as typeof db,
    );
    await postTransaction(
      ctx,
      { transactionId: draft.transactionId, acknowledgedFlags: [] },
      tx as unknown as typeof db,
    );

    // Update invoice state — sum of payment_allocations + advance_allocations
    // vs captured_total_paise.
    const settledRow = await tx.execute<{ total: string | null }>(sql`
      SELECT (
        COALESCE((SELECT SUM(allocated_paise) FROM payment_allocations WHERE invoice_id = ${invoiceId}), 0) +
        COALESCE((SELECT SUM(allocated_paise) FROM advance_allocations WHERE invoice_id = ${invoiceId}), 0)
      ) AS total
    `);
    const settledStr = Array.isArray(settledRow) ? (settledRow[0]?.total ?? '0') : '0';
    const settled = BigInt(settledStr ?? '0');

    let newState: typeof invoice.state | null = null;
    if (settled >= invoice.capturedTotalPaise) newState = 'paid';
    else if (settled > 0n) newState = 'partially_paid';
    if (newState && newState !== invoice.state) {
      await tx
        .update(invoices)
        .set({ state: newState, updatedBy: ctx.userId })
        .where(eq(invoices.id, invoiceId));
      if (newState === 'paid') {
        await logActivity(
          {
            entityType: 'client',
            entityId: invoice.clientId,
            actorId: ctx.userId,
            kind: 'invoice.paid',
            summary: `Invoice ${invoice.documentNumber} fully paid (via advance allocation)`,
            payload: {
              invoice_id: invoiceId,
              document_number: invoice.documentNumber,
              advance_id: advanceId,
              applied_paise: amount.toString(),
              gst_unwound_paise: gstUnwindPaise.toString(),
            },
          },
          tx as unknown as typeof db,
        );
      }
    }

    await logActivity(
      {
        entityType: 'client',
        entityId: advance.clientId,
        actorId: ctx.userId,
        kind: 'advance.allocated',
        summary: `₹${amount.toString()} paise of advance applied to ${invoice.documentNumber}`,
        payload: {
          advance_id: advanceId,
          invoice_id: invoiceId,
          document_number: invoice.documentNumber,
          applied_paise: amount.toString(),
          gst_unwound_paise: gstUnwindPaise.toString(),
          posted_transaction_id: draft.transactionId,
        },
      },
      tx as unknown as typeof db,
    );

    await logAudit(
      {
        actorId: ctx.userId,
        entityType: 'customer_advance',
        entityId: advanceId,
        action: 'update',
        changes: {
          allocated_to_invoice: invoiceId,
          applied_paise: amount.toString(),
          gst_unwound_paise: gstUnwindPaise.toString(),
        },
      },
      tx as unknown as typeof db,
    );

    return {
      advanceAllocationId: allocRow.id,
      appliedPaise: amount,
      gstUnwoundPaise: gstUnwindPaise,
      invoiceState: newState ?? invoice.state,
      transactionId: draft.transactionId,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Phase 4.8 — issueRefundVoucher                                             */
/* -------------------------------------------------------------------------- */

/**
 * Refund the unallocated balance of a customer advance. Creates a Rule
 * 51 refund voucher row + PDF, posts a journal that reverses the Rule
 * 50 accrual proportional to the remaining balance:
 *
 *   Dr  2180 Client Advances Received (sub: client)   refundPaise
 *     Cr  1120 Bank (sub: bank)                            refundPaise
 *   Dr  2120 GST Output Payable                       taxRefundPaise
 *     Cr  1252 Advance-Output-GST-Asset                    taxRefundPaise
 *
 * refundPaise = customer_advances.balance_paise (always full remainder)
 * taxRefundPaise = advance.advanceTaxPaise * balance / advance.advancePaise
 *
 * After posting, customer_advances.balance_paise reaches 0 once the
 * advance_balance_refresh trigger sees the (implied) full unwind. But
 * the trigger only fires on advance_allocations writes — refund is NOT
 * an allocation. So we explicitly update balance_paise = 0 in the same
 * tx.
 */
export type IssueRefundVoucherResult = {
  refundVoucherId: string;
  voucherNumber: string;
  refundVoucherDocumentId: string;
  refundPaise: bigint;
  taxRefundPaise: bigint;
  transactionId: string;
};

export async function issueRefundVoucher(args: {
  advanceId: string;
  reason: string;
}): Promise<IssueRefundVoucherResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'receive_payment');
  requireCapability(
    ctx,
    'create_journal_voucher',
    'Issuing a refund voucher posts a journal entry. create_journal_voucher capability required.',
  );

  const advanceId = z.string().uuid().parse(args.advanceId);
  const reason = z.string().trim().min(10).parse(args.reason);

  // Pull everything we need read-only before the tx so the PDF
  // assembly can run after the tx commits.
  const [advance] = await db
    .select()
    .from(customerAdvances)
    .where(eq(customerAdvances.id, advanceId))
    .limit(1);
  if (!advance) throw new AppError('not_found', `customer_advance ${advanceId} not found`);
  if (advance.balancePaise <= 0n) {
    throw new AppError('validation', `advance ${advanceId} has no remaining balance to refund.`);
  }

  const refundPaise = advance.balancePaise;
  const taxRefundPaise =
    advance.advanceTaxPaise === 0n || advance.advancePaise === 0n
      ? 0n
      : (advance.advanceTaxPaise * refundPaise) / advance.advancePaise;

  const [originalReceipt] = await db
    .select()
    .from(receipts)
    .where(eq(receipts.id, advance.originalReceiptId))
    .limit(1);
  if (!originalReceipt) {
    throw new AppError(
      'internal',
      `customer_advances.originalReceiptId ${advance.originalReceiptId} dangling — receipt missing.`,
    );
  }
  if (!originalReceipt.bankAccountId) {
    // Cash advances now exist (mode='cash' → receipts.bankAccountId is null),
    // and this refund path always credits 1120 Bank against the original bank
    // account. We deliberately BLOCK cash-advance refunds here with a clear
    // message rather than silently crediting 1110 — the follow-up (a proper
    // 1110-credit cash-refund path) is out of scope for this change.
    throw new AppError(
      'validation',
      'This advance was received in cash, so there is no bank account to refund to. Refund cash advances manually (record a cash payment / journal entry). Bank, cheque and UPI advances can be refunded here.',
    );
  }

  const [originalVoucher] = await db
    .select()
    .from(receiptVouchers)
    .where(eq(receiptVouchers.id, advance.receiptVoucherId))
    .limit(1);
  if (!originalVoucher) {
    throw new AppError(
      'internal',
      `customer_advances.receiptVoucherId ${advance.receiptVoucherId} dangling — receipt_voucher missing.`,
    );
  }

  const settings = await loadBillingSettings();
  const today = new Date().toISOString().slice(0, 10);
  const fyStart = fyStartForDate(today, settings.fyStartMonth);

  const ids = await withNumberingRetry(async () =>
    db.transaction(async (tx) =>
      insertRefundCore(tx as unknown as DbClient, ctx, {
        advance,
        originalReceiptBankAccountId: originalReceipt.bankAccountId!,
        originalVoucherNumber: originalVoucher.voucherNumber,
        reason,
        fyStart,
        today,
        refundPaise,
        taxRefundPaise,
      }),
    ),
  );

  // Generate Rule 51 PDF, upload, back-link.
  const pdfData = await assembleRefundVoucherPdfData(
    ids.refundVoucherId,
    originalVoucher.voucherNumber,
    originalVoucher.voucherDate,
  );
  const pdfBytes = await renderRefundVoucherPdf(pdfData);
  const { documentId } = await uploadBillingPdf({
    ownerId: ids.refundVoucherId,
    attachToEntity: { entityType: 'client', entityId: advance.clientId },
    documentNumber: ids.voucherNumber,
    category: 'refund_voucher',
    pdfBytes,
    actorId: ctx.userId,
  });
  await db
    .update(refundVouchers)
    .set({ sourceDocumentId: documentId, updatedBy: ctx.userId })
    .where(eq(refundVouchers.id, ids.refundVoucherId));

  return {
    refundVoucherId: ids.refundVoucherId,
    voucherNumber: ids.voucherNumber,
    refundVoucherDocumentId: documentId,
    refundPaise,
    taxRefundPaise,
    transactionId: ids.transactionId,
  };
}

async function insertRefundCore(
  tx: DbClient,
  ctx: Awaited<ReturnType<typeof getActorContext>>,
  args: {
    advance: typeof customerAdvances.$inferSelect;
    originalReceiptBankAccountId: string;
    originalVoucherNumber: string;
    reason: string;
    fyStart: string;
    today: string;
    refundPaise: bigint;
    taxRefundPaise: bigint;
  },
): Promise<{ refundVoucherId: string; voucherNumber: string; transactionId: string }> {
  const { documentNumber: voucherNumber } = await nextDocumentNumber(
    'refund_voucher',
    args.fyStart,
    tx,
  );

  const [voucherRow] = await tx
    .insert(refundVouchers)
    .values({
      voucherNumber,
      voucherDate: args.today,
      financialYearStart: args.fyStart,
      originalReceiptVoucherId: args.advance.receiptVoucherId,
      refundPaise: args.refundPaise,
      taxRefundPaise: args.taxRefundPaise,
      reason: args.reason,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning({ id: refundVouchers.id });
  if (!voucherRow) {
    throw new AppError('internal', 'refund_vouchers.insert returned no row');
  }

  // Reverse the Rule 50 postings.
  const legs: Array<{
    accountCode: string;
    side: 'debit' | 'credit';
    amountPaise: bigint;
    subledger?: {
      entityType: 'client' | 'vendor' | 'employee' | 'project' | 'office';
      entityId: string;
    };
  }> = [
    {
      accountCode: '2180',
      side: 'debit',
      amountPaise: args.refundPaise,
      subledger: { entityType: 'client', entityId: args.advance.clientId },
    },
    {
      accountCode: '1120',
      side: 'credit',
      amountPaise: args.refundPaise,
      subledger: { entityType: 'office', entityId: args.originalReceiptBankAccountId },
    },
  ];
  if (args.taxRefundPaise > 0n) {
    legs.push({ accountCode: '2120', side: 'debit', amountPaise: args.taxRefundPaise });
    legs.push({ accountCode: '1252', side: 'credit', amountPaise: args.taxRefundPaise });
  }

  const draft = await createDraftTransaction(
    ctx,
    {
      kind: 'journal',
      input: {
        externalRef: `refund_voucher:${voucherNumber}`,
        txnDate: args.today,
        journalReason: `Refund of advance ${args.advance.id} (orig RV ${args.originalVoucherNumber}): ${args.reason}`,
        legs,
        isOpeningBalance: false,
        notes: null,
      },
    },
    tx as unknown as typeof db,
  );
  await postTransaction(
    ctx,
    { transactionId: draft.transactionId, acknowledgedFlags: [] },
    tx as unknown as typeof db,
  );

  // The advance_balance_refresh trigger fires only on advance_allocations
  // writes; for a refund we explicitly zero the balance here.
  await tx
    .update(customerAdvances)
    .set({ balancePaise: 0n, updatedBy: ctx.userId })
    .where(eq(customerAdvances.id, args.advance.id));

  await logActivity(
    {
      entityType: 'client',
      entityId: args.advance.clientId,
      actorId: ctx.userId,
      kind: 'refund.issued',
      summary: `Refund voucher ${voucherNumber} for ₹${args.refundPaise.toString()} paise (+ ₹${args.taxRefundPaise.toString()} GST)`,
      payload: {
        advance_id: args.advance.id,
        refund_voucher_id: voucherRow.id,
        voucher_number: voucherNumber,
        original_receipt_voucher_id: args.advance.receiptVoucherId,
        original_voucher_number: args.originalVoucherNumber,
        refund_paise: args.refundPaise.toString(),
        tax_refund_paise: args.taxRefundPaise.toString(),
        reason: args.reason,
        posted_transaction_id: draft.transactionId,
      },
    },
    tx as unknown as typeof db,
  );

  await logAudit(
    {
      actorId: ctx.userId,
      entityType: 'refund_voucher',
      entityId: voucherRow.id,
      action: 'insert',
      changes: {
        voucher_number: voucherNumber,
        refund_paise: args.refundPaise.toString(),
        tax_refund_paise: args.taxRefundPaise.toString(),
        reason: args.reason,
      },
    },
    tx as unknown as typeof db,
  );

  return {
    refundVoucherId: voucherRow.id,
    voucherNumber,
    transactionId: draft.transactionId,
  };
}

/** Build the Rule 51 PDF data snapshot — reuses receipt-voucher data
 *  assembly for supplier/recipient, then layers refund-specific fields. */
async function assembleRefundVoucherPdfData(
  refundVoucherId: string,
  originalVoucherNumber: string,
  originalVoucherDate: string,
  client: DbClient = db,
): Promise<import('./pdf/refund-voucher').RefundVoucherPdfData> {
  const [refund] = await client
    .select()
    .from(refundVouchers)
    .where(eq(refundVouchers.id, refundVoucherId))
    .limit(1);
  if (!refund) {
    throw new AppError('not_found', `refund_voucher ${refundVoucherId} not found`);
  }

  // Pull the receipt-voucher PDF data (supplier/recipient/etc.), then
  // map the relevant fields onto the refund shape.
  const rvData = await assembleVoucherPdfData(refund.originalReceiptVoucherId, null, client);

  return {
    supplier: rvData.supplier,
    recipient: rvData.recipient,
    voucherNumber: refund.voucherNumber,
    voucherDate: refund.voucherDate,
    originalReceiptVoucherNumber: originalVoucherNumber,
    originalReceiptVoucherDate: originalVoucherDate,
    refundPaise: refund.refundPaise,
    taxRefundPaise: refund.taxRefundPaise,
    reason: refund.reason,
    isIntraState: rvData.isIntraState,
    notes: null,
  };
}
