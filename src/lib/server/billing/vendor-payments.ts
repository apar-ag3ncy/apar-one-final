'use server';

import { randomUUID } from 'node:crypto';

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import {
  bankAccounts,
  entityAddresses,
  organizations,
  transactions,
  vendors,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { createDraftTransaction, postTransaction, reverseTransaction } from '@/lib/server/ledger';

import { allocateVendorPayment } from './bill-allocations';
import { renderPaymentVoucherPdf, type PaymentVoucherPdfData } from './pdf/payment-voucher';
import { uploadBillingPdf } from './pdf/upload';

/**
 * Vendor-side counterpart to `recordManualReceipt` (receipts.ts). Records money
 * we PAY OUT to a vendor and posts it as a `vendor_payment_made` transaction
 * (Dr 2110 Trade Payables / Cr 1120 Bank), then allocates it across the
 * vendor's open bills.
 *
 * IMPORTANT — the bill model: a "vendor bill" in this app is a `transactions`
 * row with kind='vendor_bill' (created by createVendorBillDraft), NOT a row in
 * the `bills` table (that table + billing/bills.ts are not wired to the UI).
 * So everything here reads vendor_bill TRANSACTIONS, matching
 * listVendorBillsForVendor. Outstanding per bill = the 2110 payable (credit on
 * Trade Payables, which already nets off TDS we never remit to the vendor)
 * minus prior `bill_allocations`. There is no stored "paid" state on a posted
 * transaction — paid/partially-paid/remaining is always derived from this.
 */

const VendorPaymentAllocationSchema = z.object({
  billTxnId: z.string().uuid(),
  amountPaise: z.bigint().positive(),
});

export type VendorPaymentAllocationInput = z.input<typeof VendorPaymentAllocationSchema>;

const RecordVendorPaymentInputSchema = z.object({
  vendorId: z.string().uuid(),
  mode: z.enum(['bank', 'cash']).default('bank'),
  /** How the transfer went out (NEFT/RTGS/IMPS/UPI) — captured on the posting. */
  transferMethod: z.enum(['neft', 'rtgs', 'imps', 'upi']).nullish(),
  /** Our agency bank account (bank_accounts.id) — required when mode='bank' & source!='advance'. */
  bankAccountId: z.string().uuid().nullish(),
  /** The vendor's bank account we paid into (entity_bank_accounts.id) — noted. */
  counterpartyBankAccountId: z.string().uuid().nullish(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Gross amount settled against bills (= net cash paid + TDS withheld). */
  totalPaise: z.bigint().positive(),
  tdsPaise: z.bigint().nonnegative().default(0n),
  tdsSection: z.string().trim().max(20).nullish(),
  gstPaise: z.bigint().nonnegative().default(0n),
  source: z.enum(['bank', 'advance']).default('bank'),
  notes: z.string().trim().max(2000).nullish(),
  /** Explicit allocation to posted bill txns. Empty → FIFO over open bills. */
  allocations: z.array(VendorPaymentAllocationSchema).default([]),
});

export type RecordVendorPaymentInput = z.input<typeof RecordVendorPaymentInputSchema>;

export type RecordVendorPaymentResult = {
  transactionId: string;
  voucherNumber: string;
  allocatedPaise: bigint;
  unallocatedPaise: bigint;
};

/** Parse the vendor's own invoice number out of a vendor_bill externalRef
 * (`vendor_bill:<vendorId>:<documentNumber>`). */
function billDocNumber(externalRef: string): string {
  const parts = externalRef.split(':');
  return parts.length >= 3 ? parts.slice(2).join(':') : externalRef;
}

export async function recordVendorPayment(
  input: RecordVendorPaymentInput,
): Promise<RecordVendorPaymentResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'post_transaction');

  const v = RecordVendorPaymentInputSchema.parse(input);
  if (v.mode === 'bank' && v.source !== 'advance' && !v.bankAccountId) {
    throw new AppError('validation', 'Pick the bank account the money was paid from.');
  }
  if (v.tdsPaise >= v.totalPaise && v.tdsPaise > 0n) {
    throw new AppError('validation', 'TDS cannot be greater than or equal to the amount.');
  }

  const explicitSum = v.allocations.reduce((acc, a) => acc + a.amountPaise, 0n);
  if (explicitSum > v.totalPaise) {
    throw new AppError(
      'validation',
      `Allocations (${explicitSum} paise) exceed the payment total (${v.totalPaise} paise).`,
    );
  }

  // Step 1 — generate + store the payment-voucher PDF BEFORE posting, so the
  // ledger transaction has a source_document_id (the doc-less posting is
  // blocked by the `document_missing` control). Mirrors recordManualReceipt.
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

  // Step 2 — create the draft + post it (Dr 2110 / Cr 1120) in one DB txn.
  const transactionId = await db.transaction(async (tx) => {
    const draft = await createDraftTransaction(
      ctx,
      {
        kind: 'vendor_payment_made',
        input: {
          vendorId: v.vendorId,
          mode: v.mode,
          transferMethod: v.transferMethod ?? null,
          bankAccountId: v.bankAccountId ?? null,
          counterpartyBankAccountId: v.counterpartyBankAccountId ?? null,
          amountPaise: v.totalPaise,
          source: v.source,
          tdsPaise: v.tdsPaise,
          tdsSection: v.tdsSection ?? null,
          gstPaise: v.gstPaise,
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

  // Step 3 — allocate: explicit list, else FIFO over the vendor's open bills
  // (computed here off the 2110 payable so we never over-allocate). The
  // validated allocateVendorPayment performs the writes + sum-check.
  const allocations =
    v.allocations.length > 0
      ? v.allocations.map((a) => ({ billTxnId: a.billTxnId, amountPaise: a.amountPaise }))
      : await computeFifoAllocations(v.vendorId, v.totalPaise);

  let allocatedPaise = 0n;
  if (allocations.length > 0) {
    await allocateVendorPayment({ vendorPaymentTxnId: transactionId, allocations });
    allocatedPaise = allocations.reduce((acc, a) => acc + a.amountPaise, 0n);
  }

  return {
    transactionId,
    voucherNumber,
    allocatedPaise,
    unallocatedPaise: v.totalPaise - allocatedPaise,
  };
}

/** Walk the vendor's open bills oldest-first and split `paymentTotal` across
 * them (capped at each bill's 2110 outstanding). */
async function computeFifoAllocations(
  vendorId: string,
  paymentTotalPaise: bigint,
): Promise<Array<{ billTxnId: string; amountPaise: bigint }>> {
  const rows = await db.execute<{ bill_txn_id: string; outstanding: string }>(sql`
    SELECT
      t.id::text AS bill_txn_id,
      (
        COALESCE((
          SELECT SUM(p.amount_paise) FROM postings p
          JOIN accounts a ON a.id = p.account_id
          WHERE p.transaction_id = t.id AND p.side = 'credit' AND a.code = '2110'
        ), 0)
        - COALESCE((SELECT SUM(amount_paise) FROM bill_allocations WHERE bill_txn_id = t.id), 0)
      )::bigint AS outstanding
    FROM transactions t
    WHERE t.kind = 'vendor_bill'
      AND t.status = 'posted'
      AND t.reverses_id IS NULL
      AND t.paid_to_vendor_id = ${vendorId}
    ORDER BY t.txn_date ASC, t.created_at ASC
  `);

  const out: Array<{ billTxnId: string; amountPaise: bigint }> = [];
  let remaining = paymentTotalPaise;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (remaining <= 0n) break;
    const outstanding = BigInt(r.outstanding ?? '0');
    if (outstanding <= 0n) continue;
    const take = outstanding < remaining ? outstanding : remaining;
    out.push({ billTxnId: r.bill_txn_id, amountPaise: take });
    remaining -= take;
  }
  return out;
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

  const bank = v.bankAccountId
    ? (
        await db
          .select({
            displayName: bankAccounts.displayName,
            accountLast4: bankAccounts.accountLast4,
          })
          .from(bankAccounts)
          .where(eq(bankAccounts.id, v.bankAccountId))
          .limit(1)
      )[0]
    : undefined;

  // Map any explicit allocations to bill document numbers for the voucher body.
  const allocations: PaymentVoucherPdfData['allocations'] = [];
  let appliedPaise = 0n;
  if (v.allocations.length > 0) {
    const ids = v.allocations.map((a) => a.billTxnId);
    const billRows = await db
      .select({ id: transactions.id, externalRef: transactions.externalRef })
      .from(transactions)
      .where(inArray(transactions.id, ids));
    const numByTxn = new Map(billRows.map((b) => [b.id, billDocNumber(b.externalRef)]));
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
    paidFromLabel:
      v.mode === 'cash' ? 'Cash' : bank ? `${bank.displayName} ••${bank.accountLast4}` : null,
    allocations,
    unappliedPaise: v.totalPaise - appliedPaise,
    notes: v.notes ?? null,
  };
}

/**
 * Reverse a posted vendor payment (e.g. a duplicate / mis-recorded one). Posts
 * an offsetting `vendor_payment_made` entry (Dr 1120 / Cr 2110) and marks the
 * original reversed. `reverseTransaction` gates on `reverse_transaction` and
 * requires reason ≥10 chars. Note: any `bill_allocations` on the original are
 * NOT removed (the row isn't deleted), so reversal is intended for unallocated
 * payments; un-allocate first if you need to undo a settled one.
 */
export async function reverseVendorPayment(
  transactionId: string,
  reason: string,
): Promise<{ reversalTransactionId: string }> {
  const ctx = await getActorContext();
  const id = z.string().uuid().parse(transactionId);
  return reverseTransaction(ctx, { transactionId: id, reason });
}

/* -------------------------------------------------------------------------- */
/* Reads — for the vendor "Payments" tab. All off vendor_bill transactions.   */
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
    bill_txn_id: string;
    external_ref: string;
    project_id: string | null;
    project_name: string | null;
    allocated: string;
    remaining: string;
  }>(sql`
    SELECT
      ba.vendor_payment_txn_id::text AS payment_txn_id,
      bt.id::text AS bill_txn_id,
      bt.external_ref,
      bt.project_id::text AS project_id,
      pr.name AS project_name,
      ba.amount_paise::text AS allocated,
      (
        COALESCE((
          SELECT SUM(p.amount_paise) FROM postings p
          JOIN accounts a ON a.id = p.account_id
          WHERE p.transaction_id = bt.id AND p.side = 'credit' AND a.code = '2110'
        ), 0)
        - COALESCE((SELECT SUM(amount_paise) FROM bill_allocations x WHERE x.bill_txn_id = bt.id), 0)
      )::text AS remaining
    FROM bill_allocations ba
    JOIN transactions bt ON bt.id = ba.bill_txn_id
    LEFT JOIN projects pr ON pr.id = bt.project_id
    WHERE ba.vendor_payment_txn_id IN (
      SELECT id FROM transactions
      WHERE kind = 'vendor_payment_made' AND paid_to_vendor_id = ${parsed} AND reverses_id IS NULL
    )
  `);

  const allocByPayment = new Map<string, VendorPaymentAllocationRow[]>();
  for (const a of Array.isArray(allocRows) ? allocRows : []) {
    const list = allocByPayment.get(a.payment_txn_id) ?? [];
    list.push({
      billId: a.bill_txn_id,
      billDocumentNumber: billDocNumber(a.external_ref),
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
 * Outstanding = 2110 payable (credit) − prior allocations — the same figure
 * computeFifoAllocations caps against.
 */
export async function listOpenBillsForVendor(vendorId: string): Promise<readonly OpenBillRow[]> {
  await getActorContext();
  const parsed = z.string().uuid().parse(vendorId);

  const rows = await db.execute<{
    bill_txn_id: string;
    external_ref: string;
    document_date: string;
    project_id: string | null;
    project_name: string | null;
    payable: string;
    outstanding: string;
  }>(sql`
    SELECT
      t.id::text AS bill_txn_id,
      t.external_ref,
      t.txn_date::text AS document_date,
      t.project_id::text AS project_id,
      pr.name AS project_name,
      COALESCE((
        SELECT SUM(p.amount_paise) FROM postings p
        JOIN accounts a ON a.id = p.account_id
        WHERE p.transaction_id = t.id AND p.side = 'credit' AND a.code = '2110'
      ), 0)::text AS payable,
      (
        COALESCE((
          SELECT SUM(p.amount_paise) FROM postings p
          JOIN accounts a ON a.id = p.account_id
          WHERE p.transaction_id = t.id AND p.side = 'credit' AND a.code = '2110'
        ), 0)
        - COALESCE((SELECT SUM(amount_paise) FROM bill_allocations WHERE bill_txn_id = t.id), 0)
      )::bigint AS outstanding
    FROM transactions t
    LEFT JOIN projects pr ON pr.id = t.project_id
    WHERE t.kind = 'vendor_bill'
      AND t.status = 'posted'
      AND t.reverses_id IS NULL
      AND t.paid_to_vendor_id = ${parsed}
    ORDER BY t.txn_date ASC, t.created_at ASC
  `);

  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      billId: r.bill_txn_id,
      billTxnId: r.bill_txn_id,
      documentNumber: billDocNumber(r.external_ref),
      documentDate: r.document_date,
      projectId: r.project_id,
      projectName: r.project_name,
      totalPaise: BigInt(r.payable ?? '0'),
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
 * live from postings/allocations, grouped by the bill transaction's project_id.
 * Bills with no project group under "Unassigned".
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
        t.project_id,
        (
          COALESCE((
            SELECT SUM(p.amount_paise) FROM postings p
            JOIN accounts a ON a.id = p.account_id
            WHERE p.transaction_id = t.id AND p.side = 'credit' AND a.code = '2110'
          ), 0)
          - COALESCE((SELECT SUM(amount_paise) FROM bill_allocations WHERE bill_txn_id = t.id), 0)
        )::bigint AS outstanding
      FROM transactions t
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
