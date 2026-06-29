'use server';

import { randomUUID } from 'node:crypto';

import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logActivity } from '@/lib/activity';
import { db, type DbClient } from '@/lib/db/client';
import { bankAccounts, bills, entityAddresses, organizations, vendors } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { createDraftTransaction, postTransaction } from '@/lib/server/ledger';

import { allocateVendorPayment, fifoAllocateVendorPayment } from './bill-allocations';
import { renderPaymentVoucherPdf, type PaymentVoucherPdfData } from './pdf/payment-voucher';
import { uploadBillingPdf } from './pdf/upload';

/**
 * Vendor-side counterpart to `recordManualReceipt` (receipts.ts). Records money
 * we PAY OUT to a vendor and posts it to the ledger as a `vendor_payment_made`
 * transaction (Dr 2110 Trade Payables / Cr 1120 Bank), then allocates the
 * payment across the vendor's open bills and flips each settled bill's state.
 *
 *   recordVendorPayment(input)
 *     - Capability: post_transaction (same gate as recordBill / allocate*).
 *     - Generates + stores a payment-voucher PDF BEFORE posting, so the ledger
 *       transaction carries a source_document_id (the `document_missing`
 *       control is block-severity). Mirrors recordManualReceipt's order.
 *     - Allocates explicit `allocations` (else FIFO across open bills).
 *     - Flips bills.state to 'paid' / 'partially_paid' — the bill-side mirror of
 *       allocateReceipt's invoice-state logic. Settlement is measured against
 *       each bill's PAYABLE (the 2110 credit on its bill txn), NOT
 *       captured_total_paise: the payable already nets off TDS we never remit to
 *       the vendor, so comparing to captured_total would leave a bill stuck at
 *       'partially_paid' forever.
 *
 * The `vendor_payment_made` transaction IS the payment record — there is no
 * `vendor_payments` header table (unlike `receipts` on the client side), so the
 * reads below list straight off `transactions` + `bill_allocations`.
 */

const VendorPaymentAllocationSchema = z.object({
  billTxnId: z.string().uuid(),
  amountPaise: z.bigint().positive(),
});

export type VendorPaymentAllocationInput = z.input<typeof VendorPaymentAllocationSchema>;

const RecordVendorPaymentInputSchema = z.object({
  vendorId: z.string().uuid(),
  bankAccountId: z.string().uuid(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalPaise: z.bigint().positive(),
  source: z.enum(['bank', 'advance']).default('bank'),
  notes: z.string().trim().max(2000).nullish(),
  /** Explicit allocation to posted bills (by their ledger txn id). Empty → FIFO. */
  allocations: z.array(VendorPaymentAllocationSchema).default([]),
});

export type RecordVendorPaymentInput = z.input<typeof RecordVendorPaymentInputSchema>;

export type RecordVendorPaymentResult = {
  transactionId: string;
  voucherNumber: string;
  allocatedPaise: bigint;
  unallocatedPaise: bigint;
  affectedBills: Array<{ billId: string; state: 'partially_paid' | 'paid' }>;
};

export async function recordVendorPayment(
  input: RecordVendorPaymentInput,
): Promise<RecordVendorPaymentResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'post_transaction');

  const v = RecordVendorPaymentInputSchema.parse(input);

  const allocSum = v.allocations.reduce((acc, a) => acc + a.amountPaise, 0n);
  if (allocSum > v.totalPaise) {
    throw new AppError(
      'validation',
      `Allocations (${allocSum} paise) exceed the payment total (${v.totalPaise} paise).`,
    );
  }

  // Step 1 — generate the payment-voucher PDF + store it BEFORE posting, so the
  // ledger transaction has a source_document_id (the doc-less posting is
  // blocked by the `document_missing` control). Storage I/O runs outside any DB
  // transaction, mirroring recordManualReceipt.
  const ts = Date.now();
  const voucherNumber = `VPV/${v.paymentDate}/${String(ts).slice(-6)}`;
  const externalRef = `vpv:${v.vendorId}:${ts}`;
  const ownerId = randomUUID();

  const pdfData = await assembleVoucherData(v, voucherNumber);
  const pdfBytes = await renderPaymentVoucherPdf(pdfData);
  const { documentId } = await uploadBillingPdf({
    ownerId,
    attachToEntity: { entityType: 'vendor', entityId: v.vendorId },
    documentNumber: voucherNumber,
    category: 'payment_voucher',
    pdfBytes,
    actorId: ctx.userId,
  });

  // Step 2 — create the draft + post it (Dr 2110 / Cr 1120) in one DB
  // transaction. createDraftTransaction + postTransaction both accept the tx.
  const transactionId = await db.transaction(async (tx) => {
    const draft = await createDraftTransaction(
      ctx,
      {
        kind: 'vendor_payment_made',
        input: {
          vendorId: v.vendorId,
          bankAccountId: v.bankAccountId,
          amountPaise: v.totalPaise,
          source: v.source,
          billAllocations: [], // real rows written via bill_allocations below
          paymentDocumentId: documentId,
          externalRef,
          txnDate: v.paymentDate,
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
    return draft.transactionId;
  });

  // Step 3 — allocate against the vendor's open bills (explicit, else FIFO).
  let allocatedPaise = 0n;
  let unallocatedPaise = v.totalPaise;
  if (v.allocations.length > 0) {
    await allocateVendorPayment({ vendorPaymentTxnId: transactionId, allocations: v.allocations });
    allocatedPaise = allocSum;
    unallocatedPaise = v.totalPaise - allocSum;
  } else {
    const r = await fifoAllocateVendorPayment({ vendorPaymentTxnId: transactionId });
    unallocatedPaise = r.unallocatedPaise;
    allocatedPaise = v.totalPaise - r.unallocatedPaise;
  }

  // Step 4 — flip the settled bills' state (the new logic; bill-side mirror of
  // allocateReceipt). Joins bill_allocations.billTxnId → bills.posted_transaction_id.
  const affectedBills = await flipAllocatedBillStates(ctx, transactionId, v.vendorId);

  return {
    transactionId,
    voucherNumber,
    allocatedPaise,
    unallocatedPaise,
    affectedBills,
  };
}

/**
 * Recompute each bill touched by this payment and flip its state. A bill is
 * 'paid' once cumulative allocations (across ALL payments) reach its payable
 * (the 2110 credit on its bill txn), 'partially_paid' while between, unchanged
 * at zero. Mirrors allocateReceipt (~receipts.ts:437) for the vendor side.
 */
async function flipAllocatedBillStates(
  ctx: Awaited<ReturnType<typeof getActorContext>>,
  vendorPaymentTxnId: string,
  vendorId: string,
): Promise<Array<{ billId: string; state: 'partially_paid' | 'paid' }>> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{
      bill_id: string;
      state: string;
      document_number: string;
      payable: string;
      allocated: string;
    }>(sql`
      SELECT
        b.id::text AS bill_id,
        b.state::text AS state,
        b.document_number,
        COALESCE((
          SELECT SUM(p.amount_paise) FROM postings p
          WHERE p.transaction_id = b.posted_transaction_id AND p.side = 'credit'
        ), 0)::text AS payable,
        COALESCE((
          SELECT SUM(amount_paise) FROM bill_allocations
          WHERE bill_txn_id = b.posted_transaction_id
        ), 0)::text AS allocated
      FROM bills b
      WHERE b.posted_transaction_id IN (
        SELECT bill_txn_id FROM bill_allocations WHERE vendor_payment_txn_id = ${vendorPaymentTxnId}
      )
    `);

    const list = Array.isArray(rows) ? rows : [];
    const affected: Array<{ billId: string; state: 'partially_paid' | 'paid' }> = [];
    for (const r of list) {
      const payable = BigInt(r.payable ?? '0');
      const allocated = BigInt(r.allocated ?? '0');
      let newState: 'partially_paid' | 'paid' | null = null;
      if (payable > 0n && allocated >= payable) newState = 'paid';
      else if (allocated > 0n) newState = 'partially_paid';

      if (newState && newState !== r.state) {
        await tx
          .update(bills)
          .set({ state: newState, updatedBy: ctx.userId })
          .where(eq(bills.id, r.bill_id));
        affected.push({ billId: r.bill_id, state: newState });
        if (newState === 'paid') {
          await logActivity(
            {
              entityType: 'vendor',
              entityId: vendorId,
              actorId: ctx.userId,
              kind: 'transaction.posted',
              summary: `Bill ${r.document_number} fully paid`,
              payload: {
                bill_id: r.bill_id,
                vendor_document_number: r.document_number,
                vendor_payment_txn_id: vendorPaymentTxnId,
              },
            },
            tx as unknown as DbClient,
          );
        }
      }
    }
    return affected;
  });
}

/** Assemble the payment-voucher PDF snapshot (payer = us, payee = vendor). */
async function assembleVoucherData(
  v: z.infer<typeof RecordVendorPaymentInputSchema>,
  voucherNumber: string,
): Promise<PaymentVoucherPdfData> {
  const [org] = await db.select().from(organizations).limit(1);
  if (!org) {
    throw new AppError('internal', "organizations table empty; seed Apar's organization row.");
  }
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, v.vendorId)).limit(1);
  if (!vendor) throw new AppError('not_found', `vendor ${v.vendorId} not found`);

  const addresses = await db
    .select()
    .from(entityAddresses)
    .where(and(eq(entityAddresses.entityType, 'vendor'), eq(entityAddresses.entityId, v.vendorId)))
    .orderBy(asc(entityAddresses.kind));
  const addr = addresses.find((a) => a.kind === 'registered') ?? addresses[0] ?? null;

  const [bank] = await db
    .select({ displayName: bankAccounts.displayName, accountLast4: bankAccounts.accountLast4 })
    .from(bankAccounts)
    .where(eq(bankAccounts.id, v.bankAccountId))
    .limit(1);

  // Map any explicit allocations to bill document numbers for the voucher body.
  const allocations: PaymentVoucherPdfData['allocations'] = [];
  let appliedPaise = 0n;
  if (v.allocations.length > 0) {
    const billTxnIds = v.allocations.map((a) => a.billTxnId);
    const billRows = await db
      .select({
        documentNumber: bills.documentNumber,
        postedTransactionId: bills.postedTransactionId,
      })
      .from(bills)
      .where(sql`${bills.postedTransactionId} = ANY(${billTxnIds}::uuid[])`);
    const numByTxn = new Map(
      billRows
        .filter((b) => b.postedTransactionId)
        .map((b) => [b.postedTransactionId as string, b.documentNumber]),
    );
    for (const a of v.allocations) {
      allocations.push({
        documentNumber: numByTxn.get(a.billTxnId) ?? a.billTxnId,
        allocatedPaise: a.amountPaise,
      });
      appliedPaise += a.amountPaise;
    }
  }

  const payerStateCode = org.gstin && org.gstin.length >= 2 ? org.gstin.slice(0, 2) : '27';

  return {
    payer: {
      name: org.displayName ?? org.legalName,
      address: org.registeredAddress ?? '',
      gstin: org.gstin ?? null,
      pan: org.pan ?? null,
      stateCode: payerStateCode,
    },
    payee: {
      name: vendor.name,
      addressLines: addr
        ? [
            addr.line1,
            addr.line2 ?? '',
            [addr.city, addr.stateCode, addr.postalCode].filter(Boolean).join(', '),
          ].filter((s) => s && s.length > 0)
        : [],
      gstin: vendor.gstin ?? null,
    },
    voucherNumber,
    paymentDate: v.paymentDate,
    amountPaise: v.totalPaise,
    paidFromLabel: bank ? `${bank.displayName} ••${bank.accountLast4}` : null,
    allocations,
    unappliedPaise: v.totalPaise - appliedPaise,
    notes: v.notes ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Reads — for the vendor "Payments" tab.                                     */
/* -------------------------------------------------------------------------- */

export type VendorPaymentAllocationRow = {
  billId: string;
  billDocumentNumber: string;
  projectId: string | null;
  projectName: string | null;
  allocatedPaise: bigint;
  remainingOnBillPaise: bigint;
};

export type VendorPaymentRow = {
  transactionId: string;
  externalRef: string;
  txnDate: string;
  status: string;
  amountPaise: bigint;
  allocations: VendorPaymentAllocationRow[];
};

/** Lists this vendor's payments (vendor_payment_made txns) + their allocations. */
export async function listVendorPayments(vendorId: string): Promise<readonly VendorPaymentRow[]> {
  await getActorContext();
  const parsed = z.string().uuid().parse(vendorId);

  const paymentRows = await db.execute<{
    id: string;
    external_ref: string;
    txn_date: string;
    status: string;
    amount: string;
  }>(sql`
    SELECT
      t.id::text AS id,
      t.external_ref,
      t.txn_date::text AS txn_date,
      t.status::text AS status,
      COALESCE((
        SELECT SUM(p.amount_paise) FROM postings p
        WHERE p.transaction_id = t.id AND p.side = 'debit'
      ), 0)::text AS amount
    FROM transactions t
    WHERE t.kind = 'vendor_payment_made'
      AND t.paid_to_vendor_id = ${parsed}
      AND t.reverses_id IS NULL
    ORDER BY t.txn_date DESC, t.created_at DESC
  `);

  const allocRows = await db.execute<{
    payment_txn_id: string;
    bill_id: string;
    document_number: string;
    project_id: string | null;
    project_name: string | null;
    allocated: string;
    remaining: string;
  }>(sql`
    SELECT
      ba.vendor_payment_txn_id::text AS payment_txn_id,
      b.id::text AS bill_id,
      b.document_number,
      b.project_id::text AS project_id,
      pr.name AS project_name,
      ba.amount_paise::text AS allocated,
      (
        COALESCE((
          SELECT SUM(p.amount_paise) FROM postings p
          WHERE p.transaction_id = ba.bill_txn_id AND p.side = 'credit'
        ), 0)
        - COALESCE((
          SELECT SUM(amount_paise) FROM bill_allocations x WHERE x.bill_txn_id = ba.bill_txn_id
        ), 0)
      )::text AS remaining
    FROM bill_allocations ba
    JOIN bills b ON b.posted_transaction_id = ba.bill_txn_id
    LEFT JOIN projects pr ON pr.id = b.project_id
    WHERE ba.vendor_payment_txn_id IN (
      SELECT id FROM transactions
      WHERE kind = 'vendor_payment_made' AND paid_to_vendor_id = ${parsed} AND reverses_id IS NULL
    )
  `);

  const allocByPayment = new Map<string, VendorPaymentAllocationRow[]>();
  for (const a of Array.isArray(allocRows) ? allocRows : []) {
    const list = allocByPayment.get(a.payment_txn_id) ?? [];
    list.push({
      billId: a.bill_id,
      billDocumentNumber: a.document_number,
      projectId: a.project_id,
      projectName: a.project_name,
      allocatedPaise: BigInt(a.allocated ?? '0'),
      remainingOnBillPaise: BigInt(a.remaining ?? '0'),
    });
    allocByPayment.set(a.payment_txn_id, list);
  }

  return (Array.isArray(paymentRows) ? paymentRows : []).map((p) => ({
    transactionId: p.id,
    externalRef: p.external_ref,
    txnDate: p.txn_date,
    status: p.status,
    amountPaise: BigInt(p.amount ?? '0'),
    allocations: allocByPayment.get(p.id) ?? [],
  }));
}

export type OpenBillRow = {
  billId: string;
  billTxnId: string;
  documentNumber: string;
  documentDate: string;
  projectId: string | null;
  projectName: string | null;
  totalPaise: bigint;
  outstandingPaise: bigint;
};

/**
 * Open bills for a vendor (outstanding > 0), for the allocation picker.
 * Outstanding is the 2110 payable (credit postings) minus prior allocations —
 * the same figure fifoAllocateVendorPayment caps against, so the picker can
 * never let the user over-allocate a bill.
 */
export async function listOpenBillsForVendor(vendorId: string): Promise<readonly OpenBillRow[]> {
  await getActorContext();
  const parsed = z.string().uuid().parse(vendorId);

  const rows = await db.execute<{
    bill_id: string;
    bill_txn_id: string;
    document_number: string;
    document_date: string;
    project_id: string | null;
    project_name: string | null;
    total: string;
    outstanding: string;
  }>(sql`
    SELECT
      b.id::text AS bill_id,
      t.id::text AS bill_txn_id,
      b.document_number,
      b.document_date::text AS document_date,
      b.project_id::text AS project_id,
      pr.name AS project_name,
      b.captured_total_paise::text AS total,
      (
        COALESCE((
          SELECT SUM(p.amount_paise) FROM postings p
          WHERE p.transaction_id = t.id AND p.side = 'credit'
        ), 0)
        - COALESCE((
          SELECT SUM(amount_paise) FROM bill_allocations WHERE bill_txn_id = t.id
        ), 0)
      )::bigint AS outstanding
    FROM bills b
    JOIN transactions t ON t.id = b.posted_transaction_id
    LEFT JOIN projects pr ON pr.id = b.project_id
    WHERE b.vendor_id = ${parsed}
      AND t.kind = 'vendor_bill'
      AND t.status = 'posted'
      AND t.reverses_id IS NULL
      AND b.state IN ('recorded', 'partially_paid')
    ORDER BY b.document_date ASC, b.document_number ASC
  `);

  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      billId: r.bill_id,
      billTxnId: r.bill_txn_id,
      documentNumber: r.document_number,
      documentDate: r.document_date,
      projectId: r.project_id,
      projectName: r.project_name,
      totalPaise: BigInt(r.total ?? '0'),
      outstandingPaise: BigInt(r.outstanding ?? '0'),
    }))
    .filter((r) => r.outstandingPaise > 0n);
}

export type PayableByProjectRow = {
  projectId: string | null;
  projectName: string | null;
  outstandingPaise: bigint;
};

/**
 * "Due to pay" grouped by project — outstanding payable per project, computed
 * live from postings/allocations (adapts getApAging, grouped by bills.project_id
 * instead of age bucket). Bills with no project group under "Unassigned".
 */
export async function getVendorPayablesByProject(
  vendorId: string,
): Promise<{ rows: readonly PayableByProjectRow[]; totalPaise: bigint }> {
  await getActorContext();
  const parsed = z.string().uuid().parse(vendorId);

  const rows = await db.execute<{
    project_id: string | null;
    project_name: string | null;
    outstanding: string;
  }>(sql`
    WITH bill_balance AS (
      SELECT
        b.project_id,
        (
          COALESCE((
            SELECT SUM(p.amount_paise) FROM postings p
            WHERE p.transaction_id = t.id AND p.side = 'credit'
          ), 0)
          - COALESCE((
            SELECT SUM(amount_paise) FROM bill_allocations WHERE bill_txn_id = t.id
          ), 0)
        )::bigint AS outstanding
      FROM transactions t
      JOIN bills b ON b.posted_transaction_id = t.id
      WHERE t.kind = 'vendor_bill'
        AND t.status = 'posted'
        AND t.reverses_id IS NULL
        AND t.paid_to_vendor_id = ${parsed}
    )
    SELECT
      bb.project_id::text AS project_id,
      pr.name AS project_name,
      COALESCE(SUM(bb.outstanding), 0)::text AS outstanding
    FROM bill_balance bb
    LEFT JOIN projects pr ON pr.id = bb.project_id
    GROUP BY bb.project_id, pr.name
    HAVING COALESCE(SUM(bb.outstanding), 0) > 0
    ORDER BY COALESCE(SUM(bb.outstanding), 0) DESC
  `);

  const mapped = (Array.isArray(rows) ? rows : []).map((r) => ({
    projectId: r.project_id,
    projectName: r.project_name,
    outstandingPaise: BigInt(r.outstanding ?? '0'),
  }));
  const totalPaise = mapped.reduce((acc, r) => acc + r.outstandingPaise, 0n);
  return { rows: mapped, totalPaise };
}
