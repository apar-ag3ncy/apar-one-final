'use server';

import { and, asc, desc, eq, inArray, sql, sum } from 'drizzle-orm';
import { z } from 'zod';

import { logActivity } from '@/lib/activity';
import { logAudit } from '@/lib/audit';
import { fyStartForDate } from '@/lib/billing/fy';
import { db, type DbClient } from '@/lib/db/client';
import {
  clients,
  entityAddresses,
  entityTaxIdentifiers,
  invoices,
  organizations,
  paymentAllocations,
  receipts,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { createDraftTransaction, postTransaction } from '@/lib/server/ledger';

import { loadBillingSettings, nextDocumentNumber, withNumberingRetry } from './numbering';
import { renderPaymentReceiptPdf, type PaymentReceiptPdfData } from './pdf/payment-receipt';
import { uploadBillingPdf } from './pdf/upload';

/**
 * Customer-payment receipts. Phase 4.5.
 *
 *   recordManualReceipt(input)
 *     - Capability: receive_payment.
 *     - Inserts receipts row, posts ledger via client_payment_received
 *       template (Dr 1120 Bank sub:bank / Cr 1200 Trade Receivables sub:client).
 *     - Optional `allocations` array — if non-empty, runs allocateReceipt
 *       in the same logical action so the new receipt isn't sitting
 *       unallocated.
 *
 *   allocateReceipt(receiptId, allocations[])
 *     - Capability: receive_payment.
 *     - Empty `allocations` → FIFO across the client's open invoices
 *       (state in sent | partially_paid, oldest document_date first).
 *     - Refuses to over-allocate (DB trigger enforces too; this is the
 *       UX-friendly pre-check).
 *     - Updates invoice.state: sum >= captured_total → 'paid';
 *       sum > 0 → 'partially_paid'; sum == 0 → no change.
 *     - Logs payment.allocated per invoice and invoice.paid on
 *       transition.
 *
 * Razorpay-driven receipts (Phase 4.4 webhook) live separately — they
 * insert receipts with gateway_payment_id + razorpay_event_id + method
 * = 'razorpay' and short-circuit allocation via razorpay_payment_link_id.
 * Phase 4.2/4.4 not in this build.
 */

const ReceiptIdSchema = z.string().uuid();
const InvoiceIdSchema = z.string().uuid();

const AllocationInputSchema = z.object({
  invoiceId: InvoiceIdSchema,
  allocatedPaise: z.bigint().positive(),
});

export type AllocationInput = z.input<typeof AllocationInputSchema>;

const RecordManualReceiptInputSchema = z.object({
  clientId: z.string().uuid(),
  bankAccountId: z.string().uuid().nullish(),
  receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalPaise: z.bigint().positive(),
  method: z.enum(['bank_transfer', 'upi', 'cheque', 'cash', 'card']),
  // Customer-side TDS deducted from us — captured, not computed.
  capturedTdsAmountPaise: z.bigint().nonnegative().default(0n),
  capturedTdsSection: z.string().trim().max(20).nullish(),
  capturedTdsRateBps: z.number().int().min(0).max(10000).default(0),
  notes: z.string().trim().max(2000).nullish(),
  /** Optional pre-allocation; runs allocateReceipt as the same logical action. */
  allocations: z.array(AllocationInputSchema).default([]),
});

export type RecordManualReceiptInput = z.input<typeof RecordManualReceiptInputSchema>;

export type RecordManualReceiptResult = {
  id: string;
  receiptNumber: string;
  transactionId: string;
  allocatedPaise: bigint;
  affectedInvoices: Array<{ invoiceId: string; state: 'partially_paid' | 'paid' }>;
};

export async function recordManualReceipt(
  input: RecordManualReceiptInput,
): Promise<RecordManualReceiptResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'receive_payment');

  const v = RecordManualReceiptInputSchema.parse(input);
  if (v.method !== 'cash' && !v.bankAccountId) {
    throw new AppError('validation', 'bankAccountId is required for non-cash receipt methods.');
  }
  // For cash receipts, the ledger debit goes to '1110 Cash on Hand'
  // (no subledger). For everything else, 1120 sub:bank_account.
  // The template requires bankAccountId; for cash we pass a synthetic
  // null and post via journal instead. Cleaner: refuse cash for now and
  // surface it as a separate path.
  if (v.method === 'cash') {
    throw new AppError(
      'validation',
      'cash receipts are not supported in this build; record via Office Expenses → cash receipt flow instead.',
    );
  }

  const settings = await loadBillingSettings();
  const fyStart = fyStartForDate(v.receiptDate, settings.fyStartMonth);

  // Step 1 — allocate the receipt number + insert the receipts row, NOT yet
  // posted. Numbering-retry guards against concurrent number collisions.
  const receipt = await withNumberingRetry(async () =>
    db.transaction(async (tx) => insertReceiptRow(tx as unknown as DbClient, ctx, v, fyStart)),
  );

  // Step 2 — generate the payment-receipt PDF and store it BEFORE posting, so
  // the ledger transaction carries a source_document_id. The `document_missing`
  // control (validation.ts) blocks any doc-less posting; this mirrors the
  // document-then-post order sendInvoice already uses. Storage I/O runs outside
  // a DB transaction.
  const pdfData = await assemblePaymentReceiptData(v, receipt.receiptNumber);
  const pdfBytes = await renderPaymentReceiptPdf(pdfData);
  const { documentId } = await uploadBillingPdf({
    ownerId: receipt.id,
    attachToEntity: { entityType: 'client', entityId: v.clientId },
    documentNumber: receipt.receiptNumber,
    category: 'receipt_voucher',
    pdfBytes,
    actorId: ctx.userId,
  });

  // Step 3 — post the ledger with the receipt document attached, and back-link
  // the posted transaction + source document onto the receipt row.
  const transactionId = await db.transaction(async (tx) =>
    postReceiptTransaction(tx as unknown as DbClient, ctx, v, receipt, documentId),
  );

  // Step 4 — pre-allocations, if supplied. allocateReceipt handles its own
  // validation + invoice-state updates.
  let allocatedPaise = 0n;
  let affectedInvoices: RecordManualReceiptResult['affectedInvoices'] = [];
  if (v.allocations.length > 0) {
    const result = await allocateReceipt(receipt.id, v.allocations);
    allocatedPaise = result.allocatedPaise;
    affectedInvoices = result.affectedInvoices;
  }

  return {
    id: receipt.id,
    receiptNumber: receipt.receiptNumber,
    transactionId,
    allocatedPaise,
    affectedInvoices,
  };
}

/** Allocate the receipt number + insert the receipts row (not yet posted). */
async function insertReceiptRow(
  tx: DbClient,
  ctx: Awaited<ReturnType<typeof getActorContext>>,
  v: z.infer<typeof RecordManualReceiptInputSchema>,
  fyStart: string,
): Promise<{ id: string; receiptNumber: string }> {
  const { documentNumber: receiptNumber } = await nextDocumentNumber('receipt', fyStart, tx);

  const [row] = await tx
    .insert(receipts)
    .values({
      receiptNumber,
      receiptDate: v.receiptDate,
      financialYearStart: fyStart,
      clientId: v.clientId,
      bankAccountId: v.bankAccountId ?? null,
      totalPaise: v.totalPaise,
      method: v.method,
      capturedTdsAmountPaise: v.capturedTdsAmountPaise,
      capturedTdsSection: v.capturedTdsSection ?? null,
      capturedTdsRateBps: v.capturedTdsRateBps,
      notes: v.notes ?? null,
      validationFlags: [],
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning({ id: receipts.id, receiptNumber: receipts.receiptNumber });
  if (!row) throw new AppError('internal', 'receipts.insert returned no row');

  await logAudit(
    {
      actorId: ctx.userId,
      entityType: 'receipt',
      entityId: row.id,
      action: 'insert',
      changes: { receipt_number: receiptNumber, total_paise: v.totalPaise.toString() },
    },
    tx as unknown as typeof db,
  );

  return row;
}

/**
 * Post the client_payment_received ledger txn (Dr 1120 Bank / Cr 1200 AR),
 * passing the just-generated receipt PDF as the source document so the
 * `document_missing` control is satisfied, then back-link the posted txn +
 * source document onto the receipts row.
 */
async function postReceiptTransaction(
  tx: DbClient,
  ctx: Awaited<ReturnType<typeof getActorContext>>,
  v: z.infer<typeof RecordManualReceiptInputSchema>,
  receipt: { id: string; receiptNumber: string },
  receiptDocumentId: string,
): Promise<string> {
  const draft = await createDraftTransaction(
    ctx,
    {
      kind: 'client_payment_received',
      input: {
        clientId: v.clientId,
        bankAccountId: v.bankAccountId!, // non-null per the cash check above
        amountPaise: v.totalPaise,
        receiptDocumentId,
        externalRef: `receipt:${receipt.receiptNumber}`,
        txnDate: v.receiptDate,
        invoiceAllocations: [], // tracked in payment_allocations; metadata-light here
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

  await tx
    .update(receipts)
    .set({
      postedTransactionId: draft.transactionId,
      sourceDocumentId: receiptDocumentId,
      updatedBy: ctx.userId,
    })
    .where(eq(receipts.id, receipt.id));

  await logActivity(
    {
      entityType: 'client',
      entityId: v.clientId,
      actorId: ctx.userId,
      kind: 'payment.received',
      summary: `Receipt ${receipt.receiptNumber} for ₹${v.totalPaise.toString()} paise (${v.method})`,
      payload: {
        receipt_id: receipt.id,
        receipt_number: receipt.receiptNumber,
        total_paise: v.totalPaise.toString(),
        method: v.method,
        posted_transaction_id: draft.transactionId,
        source_document_id: receiptDocumentId,
      },
    },
    tx as unknown as typeof db,
  );

  return draft.transactionId;
}

/** Assemble the payment-receipt PDF snapshot (supplier, recipient, applied invoices). */
async function assemblePaymentReceiptData(
  v: z.infer<typeof RecordManualReceiptInputSchema>,
  receiptNumber: string,
): Promise<PaymentReceiptPdfData> {
  const [org] = await db.select().from(organizations).limit(1);
  if (!org) {
    throw new AppError('internal', "organizations table empty; seed Apar's organization row.");
  }
  const [client] = await db.select().from(clients).where(eq(clients.id, v.clientId)).limit(1);
  if (!client) throw new AppError('not_found', `client ${v.clientId} not found`);

  const addresses = await db
    .select()
    .from(entityAddresses)
    .where(and(eq(entityAddresses.entityType, 'client'), eq(entityAddresses.entityId, v.clientId)))
    .orderBy(asc(entityAddresses.kind));
  const addr = addresses.find((a) => a.kind === 'registered') ?? addresses[0] ?? null;

  const [gstinRow] = await db
    .select({ value: entityTaxIdentifiers.maskedValue })
    .from(entityTaxIdentifiers)
    .where(
      and(
        eq(entityTaxIdentifiers.entityType, 'client'),
        eq(entityTaxIdentifiers.entityId, v.clientId),
        eq(entityTaxIdentifiers.kind, 'gstin'),
      ),
    )
    .limit(1);

  const allocations: PaymentReceiptPdfData['allocations'] = [];
  let appliedPaise = 0n;
  if (v.allocations.length > 0) {
    const ids = v.allocations.map((a) => a.invoiceId);
    const rows = await db
      .select({ id: invoices.id, documentNumber: invoices.documentNumber })
      .from(invoices)
      .where(inArray(invoices.id, ids));
    const numById = new Map(rows.map((r) => [r.id, r.documentNumber]));
    for (const a of v.allocations) {
      allocations.push({
        documentNumber: numById.get(a.invoiceId) ?? a.invoiceId,
        allocatedPaise: a.allocatedPaise,
      });
      appliedPaise += a.allocatedPaise;
    }
  }

  const supplierStateCode = org.gstin && org.gstin.length >= 2 ? org.gstin.slice(0, 2) : '27';

  return {
    supplier: {
      name: org.displayName ?? org.legalName,
      address: org.registeredAddress ?? '',
      gstin: org.gstin ?? null,
      pan: org.pan ?? null,
      stateCode: supplierStateCode,
    },
    recipient: {
      name: client.name,
      addressLines: addr
        ? [
            addr.line1,
            addr.line2 ?? '',
            [addr.city, addr.stateCode, addr.postalCode].filter(Boolean).join(', '),
          ].filter((s) => s && s.length > 0)
        : [],
      gstin: gstinRow?.value ?? null,
    },
    receiptNumber,
    receiptDate: v.receiptDate,
    amountPaise: v.totalPaise,
    method: v.method,
    bankLabel: null,
    allocations,
    unappliedPaise: v.totalPaise - appliedPaise,
    notes: v.notes ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* allocateReceipt                                                            */
/* -------------------------------------------------------------------------- */

export type AllocateReceiptResult = {
  allocatedPaise: bigint;
  affectedInvoices: Array<{ invoiceId: string; state: 'partially_paid' | 'paid' }>;
};

export async function allocateReceipt(
  receiptId: string,
  allocations: ReadonlyArray<AllocationInput> = [],
): Promise<AllocateReceiptResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'receive_payment');
  const parsedId = ReceiptIdSchema.parse(receiptId);
  const parsedAllocs = allocations.map((a) => AllocationInputSchema.parse(a));

  return db.transaction(async (tx) => {
    const [receipt] = await tx.select().from(receipts).where(eq(receipts.id, parsedId)).limit(1);
    if (!receipt) throw new AppError('not_found', `receipt ${parsedId} not found`);

    // Existing allocations on this receipt.
    const [existingAgg] = await tx
      .select({ total: sum(paymentAllocations.allocatedPaise) })
      .from(paymentAllocations)
      .where(eq(paymentAllocations.receiptId, parsedId));
    const existingPaise = existingAgg?.total != null ? BigInt(existingAgg.total as string) : 0n;
    const remaining = receipt.totalPaise - existingPaise;
    if (remaining <= 0n) {
      throw new AppError(
        'validation',
        `receipt ${parsedId} is fully allocated; nothing left to apply.`,
      );
    }

    // Build the allocations to insert.
    const toInsert: Array<{ invoiceId: string; allocatedPaise: bigint }> =
      parsedAllocs.length > 0
        ? [...parsedAllocs]
        : await pickFifoAllocations(tx as unknown as DbClient, receipt.clientId, remaining);

    if (toInsert.length === 0) {
      throw new AppError(
        'validation',
        `no open invoices found for client ${receipt.clientId} to FIFO-allocate against.`,
      );
    }

    const requestedSum = toInsert.reduce((acc, a) => acc + a.allocatedPaise, 0n);
    if (requestedSum > remaining) {
      throw new AppError(
        'validation',
        `requested allocation ${requestedSum} paise exceeds remaining ${remaining} paise on receipt.`,
      );
    }

    await tx.insert(paymentAllocations).values(
      toInsert.map((a) => ({
        receiptId: parsedId,
        invoiceId: a.invoiceId,
        allocatedPaise: a.allocatedPaise,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })),
    );

    // Re-compute each affected invoice's cumulative allocation and flip state.
    const affectedInvoiceIds = Array.from(new Set(toInsert.map((a) => a.invoiceId)));
    const sums = await tx
      .select({
        invoiceId: paymentAllocations.invoiceId,
        sumPaise: sum(paymentAllocations.allocatedPaise),
      })
      .from(paymentAllocations)
      .where(inArray(paymentAllocations.invoiceId, affectedInvoiceIds))
      .groupBy(paymentAllocations.invoiceId);
    const sumByInvoice = new Map<string, bigint>();
    for (const s of sums) {
      sumByInvoice.set(s.invoiceId, BigInt((s.sumPaise as string | null) ?? '0'));
    }

    const invoiceRows = await tx
      .select()
      .from(invoices)
      .where(inArray(invoices.id, affectedInvoiceIds));
    const invoiceById = new Map(invoiceRows.map((i) => [i.id, i]));

    const affected: AllocateReceiptResult['affectedInvoices'] = [];
    for (const inv of invoiceRows) {
      const cumulative = sumByInvoice.get(inv.id) ?? 0n;
      let newState: typeof inv.state | null = null;
      if (cumulative >= inv.capturedTotalPaise) newState = 'paid';
      else if (cumulative > 0n) newState = 'partially_paid';

      if (newState && newState !== inv.state) {
        await tx
          .update(invoices)
          .set({ state: newState, updatedBy: ctx.userId })
          .where(eq(invoices.id, inv.id));
        if (newState === 'paid' || newState === 'partially_paid') {
          affected.push({ invoiceId: inv.id, state: newState });
        }
        if (newState === 'paid') {
          await logActivity(
            {
              entityType: 'client',
              entityId: inv.clientId,
              actorId: ctx.userId,
              kind: 'invoice.paid',
              summary: `Invoice ${inv.documentNumber} fully paid`,
              payload: {
                invoice_id: inv.id,
                document_number: inv.documentNumber,
                receipt_id: parsedId,
                receipt_number: receipt.receiptNumber,
              },
            },
            tx as unknown as typeof db,
          );
        }
      }

      const thisAlloc = toInsert.find((a) => a.invoiceId === inv.id)?.allocatedPaise ?? 0n;
      if (thisAlloc > 0n) {
        await logActivity(
          {
            entityType: 'client',
            entityId: inv.clientId,
            actorId: ctx.userId,
            kind: 'payment.allocated',
            summary: `₹${thisAlloc.toString()} paise applied to ${inv.documentNumber} from receipt ${receipt.receiptNumber}`,
            payload: {
              invoice_id: inv.id,
              document_number: inv.documentNumber,
              receipt_id: parsedId,
              receipt_number: receipt.receiptNumber,
              allocated_paise: thisAlloc.toString(),
              cumulative_allocated_paise: cumulative.toString(),
              invoice_state_after: invoiceById.get(inv.id)?.state ?? null,
            },
          },
          tx as unknown as typeof db,
        );
      }
    }

    const allocatedNow = toInsert.reduce((acc, a) => acc + a.allocatedPaise, 0n);
    return { allocatedPaise: allocatedNow, affectedInvoices: affected };
  });
}

async function pickFifoAllocations(
  client: DbClient,
  clientId: string,
  remaining: bigint,
): Promise<Array<{ invoiceId: string; allocatedPaise: bigint }>> {
  const openInvoices = await client
    .select({
      id: invoices.id,
      capturedTotalPaise: invoices.capturedTotalPaise,
      documentDate: invoices.documentDate,
    })
    .from(invoices)
    .where(
      and(eq(invoices.clientId, clientId), inArray(invoices.state, ['sent', 'partially_paid'])),
    )
    .orderBy(asc(invoices.documentDate), asc(invoices.documentNumber));

  if (openInvoices.length === 0) return [];

  // For each invoice, fetch how much is already allocated to it.
  const allocSums = await client
    .select({
      invoiceId: paymentAllocations.invoiceId,
      sumPaise: sum(paymentAllocations.allocatedPaise),
    })
    .from(paymentAllocations)
    .where(
      inArray(
        paymentAllocations.invoiceId,
        openInvoices.map((i) => i.id),
      ),
    )
    .groupBy(paymentAllocations.invoiceId);
  const allocated = new Map<string, bigint>();
  for (const a of allocSums) {
    allocated.set(a.invoiceId, BigInt((a.sumPaise as string | null) ?? '0'));
  }

  const out: Array<{ invoiceId: string; allocatedPaise: bigint }> = [];
  let left = remaining;
  for (const inv of openInvoices) {
    if (left <= 0n) break;
    const due = inv.capturedTotalPaise - (allocated.get(inv.id) ?? 0n);
    if (due <= 0n) continue;
    const apply = due < left ? due : left;
    out.push({ invoiceId: inv.id, allocatedPaise: apply });
    left -= apply;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* getReceipt / listReceipts                                                  */
/* -------------------------------------------------------------------------- */

export type ReceiptWithAllocations = {
  receipt: typeof receipts.$inferSelect;
  allocations: Array<typeof paymentAllocations.$inferSelect>;
};

export async function getReceipt(id: string): Promise<ReceiptWithAllocations | null> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'receive_payment');
  const parsed = ReceiptIdSchema.parse(id);
  const [row] = await db.select().from(receipts).where(eq(receipts.id, parsed)).limit(1);
  if (!row) return null;
  const allocs = await db
    .select()
    .from(paymentAllocations)
    .where(eq(paymentAllocations.receiptId, parsed));
  return { receipt: row, allocations: allocs };
}

export type ListReceiptsFilters = {
  clientId?: string;
  method?: typeof receipts.$inferSelect.method;
  receiptDateFrom?: string;
  receiptDateTo?: string;
  limit?: number;
  offset?: number;
};

export async function listReceipts(
  filters: ListReceiptsFilters = {},
): Promise<{ rows: Array<typeof receipts.$inferSelect>; total: number }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'receive_payment');

  const conds = [];
  if (filters.clientId) conds.push(eq(receipts.clientId, filters.clientId));
  if (filters.method) conds.push(eq(receipts.method, filters.method));
  if (filters.receiptDateFrom)
    conds.push(sql`${receipts.receiptDate} >= ${filters.receiptDateFrom}`);
  if (filters.receiptDateTo) conds.push(sql`${receipts.receiptDate} <= ${filters.receiptDateTo}`);
  const where = conds.length > 0 ? and(...conds) : undefined;

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  const rows = await db
    .select()
    .from(receipts)
    .where(where)
    .orderBy(desc(receipts.receiptDate), desc(receipts.receiptNumber))
    .limit(limit)
    .offset(offset);

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(receipts)
    .where(where);
  return { rows, total: totalRow?.count ?? 0 };
}
