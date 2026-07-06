'use server';

import { randomUUID } from 'node:crypto';

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logActivity } from '@/lib/activity';
import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import {
  clients,
  entityAddresses,
  entityTaxIdentifiers,
  organizations,
  receiptAllocations,
  transactions,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { createDraftTransaction, postTransaction, reverseTransaction } from '@/lib/server/ledger';

import { renderPaymentReceiptPdf, type PaymentReceiptPdfData } from './pdf/payment-receipt';
import { uploadBillingPdf } from './pdf/upload';

/**
 * Client-side money-recording on the LEDGER model — the mirror of
 * vendor-payments.ts. A "client invoice" in the (app) is a `client_invoice`
 * TRANSACTION (created via the Invoices tab), NOT a row in the formal `invoices`
 * table. So receipts here read/allocate against `client_invoice` txns:
 * outstanding = Σ(1200 debit on the invoice txn) − Σ `receipt_allocations`.
 *
 * recordClientReceipt posts `client_payment_received` (Dr bank/cash + Dr 1260
 * TDS-receivable / Cr 1200) and allocates the gross against open invoices. The
 * formal `invoices`-table receipts (recordManualReceipt, OS shell) are untouched.
 */

const ReceiptAllocationSchema = z.object({
  invoiceTxnId: z.string().uuid(),
  amountPaise: z.bigint().positive(),
});

export type ReceiptAllocationInput = z.input<typeof ReceiptAllocationSchema>;

const RecordClientReceiptInputSchema = z.object({
  clientId: z.string().uuid(),
  mode: z.enum(['bank', 'cash']).default('bank'),
  /** Our agency bank account (bank_accounts.id) — required when mode='bank'. */
  bankAccountId: z.string().uuid().nullish(),
  /** The client's bank account the money came from (entity_bank_accounts.id) — noted. */
  counterpartyBankAccountId: z.string().uuid().nullish(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Gross amount settled against invoices (= net cash received + TDS withheld). */
  totalPaise: z.bigint().positive(),
  tdsPaise: z.bigint().nonnegative().default(0n),
  tdsSection: z.string().trim().max(20).nullish(),
  gstPaise: z.bigint().nonnegative().default(0n),
  notes: z.string().trim().max(2000).nullish(),
  /** Explicit allocation to posted client_invoice txns. */
  allocations: z.array(ReceiptAllocationSchema).default([]),
  /**
   * When true (default) and no explicit `allocations` are given, the receipt
   * is auto-applied FIFO to the client's oldest open invoices. Set false to
   * record the receipt WITHOUT auto-allocating — the money sits as an
   * unallocated credit on the client's account, to be applied later.
   */
  autoAllocate: z.boolean().default(true),
});

export type RecordClientReceiptInput = z.input<typeof RecordClientReceiptInputSchema>;

export type RecordClientReceiptResult = {
  transactionId: string;
  receiptNumber: string;
  allocatedPaise: bigint;
  unallocatedPaise: bigint;
};

/** Parse the invoice number out of a client_invoice externalRef (`client_invoice:<num>`). */
function invoiceDocNumber(externalRef: string): string {
  return externalRef.startsWith('client_invoice:')
    ? externalRef.slice('client_invoice:'.length)
    : externalRef;
}

export async function recordClientReceipt(
  input: RecordClientReceiptInput,
): Promise<RecordClientReceiptResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'receive_payment');

  const v = RecordClientReceiptInputSchema.parse(input);
  if (v.mode === 'bank' && !v.bankAccountId) {
    throw new AppError('validation', 'Pick the bank account the money was received into.');
  }
  if (v.tdsPaise >= v.totalPaise && v.tdsPaise > 0n) {
    throw new AppError('validation', 'TDS cannot be greater than or equal to the amount.');
  }
  const explicitSum = v.allocations.reduce((acc, a) => acc + a.amountPaise, 0n);
  if (explicitSum > v.totalPaise) {
    throw new AppError(
      'validation',
      `Allocations (${explicitSum} paise) exceed the receipt total (${v.totalPaise} paise).`,
    );
  }

  // Step 1 — generate + store the receipt voucher BEFORE posting (the ledger
  // requires a source_document_id; document_missing blocks doc-less postings).
  const ts = Date.now();
  const receiptNumber = `RCPT/${v.paymentDate}/${String(ts).slice(-6)}`;
  const externalRef = `crcpt:${v.clientId}:${ts}`;
  const ownerId = randomUUID();

  const pdfData = await assembleReceiptData(v, receiptNumber);
  const pdfBytes = await renderPaymentReceiptPdf(pdfData);
  const { documentId } = await uploadBillingPdf({
    ownerId,
    attachToEntity: { entityType: 'client', entityId: v.clientId },
    documentNumber: receiptNumber,
    category: 'receipt_voucher',
    pdfBytes,
    actorId: ctx.userId,
  });

  // Step 2 — create the draft + post it (Dr bank/cash + Dr 1260 / Cr 1200).
  const transactionId = await db.transaction(async (tx) => {
    const draft = await createDraftTransaction(
      ctx,
      {
        kind: 'client_payment_received',
        input: {
          clientId: v.clientId,
          mode: v.mode,
          bankAccountId: v.bankAccountId ?? null,
          counterpartyBankAccountId: v.counterpartyBankAccountId ?? null,
          amountPaise: v.totalPaise,
          tdsPaise: v.tdsPaise,
          tdsSection: v.tdsSection ?? null,
          gstPaise: v.gstPaise,
          receiptDocumentId: documentId,
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

  // Step 3 — allocate against open client_invoice txns. Explicit allocations
  // win; otherwise auto-apply FIFO — unless autoAllocate is off, in which case
  // the receipt stays unallocated (a credit on the client's account).
  const allocations =
    v.allocations.length > 0
      ? v.allocations.map((a) => ({ invoiceTxnId: a.invoiceTxnId, amountPaise: a.amountPaise }))
      : v.autoAllocate
        ? await computeFifoAllocations(v.clientId, v.totalPaise)
        : [];

  let allocatedPaise = 0n;
  if (allocations.length > 0) {
    await allocateClientReceipt(ctx, transactionId, v.clientId, allocations);
    allocatedPaise = allocations.reduce((acc, a) => acc + a.amountPaise, 0n);
  }

  return {
    transactionId,
    receiptNumber,
    allocatedPaise,
    unallocatedPaise: v.totalPaise - allocatedPaise,
  };
}

/** Validate + write receipt_allocations (mirror of allocateVendorPayment). */
async function allocateClientReceipt(
  ctx: Awaited<ReturnType<typeof getActorContext>>,
  paymentTxnId: string,
  clientId: string,
  allocations: ReadonlyArray<{ invoiceTxnId: string; amountPaise: bigint }>,
): Promise<void> {
  if (allocations.length === 0) return;
  await db.transaction(async (tx) => {
    const invoiceIds = allocations.map((a) => a.invoiceTxnId);
    const invoices = await tx
      .select({
        id: transactions.id,
        kind: transactions.kind,
        status: transactions.status,
        relatedEntityId: transactions.relatedEntityId,
      })
      .from(transactions)
      .where(inArray(transactions.id, invoiceIds));
    const byId = new Map(invoices.map((i) => [i.id, i]));
    for (const a of allocations) {
      const inv = byId.get(a.invoiceTxnId);
      if (!inv) throw new AppError('not_found', `invoice txn ${a.invoiceTxnId} not found`);
      if (inv.kind !== 'client_invoice') {
        throw new AppError(
          'validation',
          `txn ${a.invoiceTxnId} is ${inv.kind}, not client_invoice`,
        );
      }
      if (inv.status !== 'posted') {
        throw new AppError('validation', `invoice ${a.invoiceTxnId} is ${inv.status}, not posted`);
      }
      if (inv.relatedEntityId !== clientId) {
        throw new AppError('validation', `invoice ${a.invoiceTxnId} belongs to another client`);
      }
    }
    await tx.insert(receiptAllocations).values(
      allocations.map((a) => ({
        clientPaymentTxnId: paymentTxnId,
        clientInvoiceTxnId: a.invoiceTxnId,
        amountPaise: a.amountPaise,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })),
    );
    await logAudit({
      actorId: ctx.userId,
      entityType: 'transaction',
      entityId: paymentTxnId,
      action: 'update',
      changes: {
        receipt_allocations: {
          before: null,
          after: allocations.map((a) => ({
            invoice_txn_id: a.invoiceTxnId,
            amount_paise: a.amountPaise.toString(),
          })),
        },
      },
    });
    await logActivity({
      entityType: 'client',
      entityId: clientId,
      actorId: ctx.userId,
      kind: 'payment.allocated',
      summary: `Receipt allocated across ${allocations.length} invoice(s)`,
      payload: { client_payment_txn_id: paymentTxnId, allocation_count: allocations.length },
    });
  });
}

/** Walk the client's open invoices oldest-first, capped at each one's outstanding. */
async function computeFifoAllocations(
  clientId: string,
  receiptTotalPaise: bigint,
): Promise<Array<{ invoiceTxnId: string; amountPaise: bigint }>> {
  const rows = await db.execute<{ invoice_txn_id: string; outstanding: string }>(sql`
    SELECT
      t.id::text AS invoice_txn_id,
      (
        COALESCE((
          SELECT SUM(p.amount_paise) FROM postings p
          JOIN accounts a ON a.id = p.account_id
          WHERE p.transaction_id = t.id AND p.side = 'debit' AND a.code = '1200'
        ), 0)
        - COALESCE((SELECT SUM(amount_paise) FROM receipt_allocations WHERE client_invoice_txn_id = t.id), 0)
      )::bigint AS outstanding
    FROM transactions t
    WHERE t.kind = 'client_invoice'
      AND t.status = 'posted'
      AND t.reverses_id IS NULL
      AND t.related_entity_id = ${clientId}
    ORDER BY t.txn_date ASC, t.created_at ASC
  `);

  const out: Array<{ invoiceTxnId: string; amountPaise: bigint }> = [];
  let remaining = receiptTotalPaise;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (remaining <= 0n) break;
    const outstanding = BigInt(r.outstanding ?? '0');
    if (outstanding <= 0n) continue;
    const take = outstanding < remaining ? outstanding : remaining;
    out.push({ invoiceTxnId: r.invoice_txn_id, amountPaise: take });
    remaining -= take;
  }
  return out;
}

/** Receipt-voucher PDF snapshot (supplier = us, recipient = client). */
async function assembleReceiptData(
  v: z.infer<typeof RecordClientReceiptInputSchema>,
  receiptNumber: string,
): Promise<PaymentReceiptPdfData> {
  const [org] = await db.select().from(organizations).limit(1);
  if (!org) throw new AppError('internal', "organizations table empty; seed Apar's org row.");
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
    const ids = v.allocations.map((a) => a.invoiceTxnId);
    const rows = await db
      .select({ id: transactions.id, externalRef: transactions.externalRef })
      .from(transactions)
      .where(inArray(transactions.id, ids));
    const numById = new Map(rows.map((r) => [r.id, invoiceDocNumber(r.externalRef)]));
    for (const a of v.allocations) {
      allocations.push({
        documentNumber: numById.get(a.invoiceTxnId) ?? a.invoiceTxnId,
        allocatedPaise: a.amountPaise,
      });
      appliedPaise += a.amountPaise;
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
    receiptDate: v.paymentDate,
    amountPaise: v.totalPaise,
    method: v.mode === 'cash' ? 'cash' : 'bank_transfer',
    bankLabel: null,
    allocations,
    unappliedPaise: v.totalPaise - appliedPaise,
    notes: v.notes ?? null,
  };
}

/** Reverse a posted client receipt (offsetting entry; marks the original reversed). */
export async function reverseClientReceipt(
  transactionId: string,
  reason: string,
): Promise<{ reversalTransactionId: string }> {
  const ctx = await getActorContext();
  const id = z.string().uuid().parse(transactionId);
  return reverseTransaction(ctx, { transactionId: id, reason });
}

/* -------------------------------------------------------------------------- */
/* Reads — for the client "Payments" tab. All off client_invoice transactions. */
/* -------------------------------------------------------------------------- */

export type ClientReceiptAllocationRow = {
  invoiceId: string;
  invoiceDocumentNumber: string;
  projectId: string | null;
  projectName: string | null;
  allocatedPaise: bigint;
  remainingOnInvoicePaise: bigint;
};

export type ClientReceiptRow = {
  transactionId: string;
  externalRef: string;
  txnDate: string;
  status: string;
  amountPaise: bigint;
  /** The stored receipt-voucher PDF (the txn's source document) — for view/download. */
  sourceDocumentId: string | null;
  allocations: ClientReceiptAllocationRow[];
};

export async function listClientReceipts(clientId: string): Promise<readonly ClientReceiptRow[]> {
  await getActorContext();
  const parsed = z.string().uuid().parse(clientId);

  const paymentRows = await db.execute<{
    id: string;
    external_ref: string;
    txn_date: string;
    status: string;
    amount: string;
    source_document_id: string | null;
  }>(sql`
    SELECT
      t.id::text AS id,
      t.external_ref,
      t.txn_date::text AS txn_date,
      t.status::text AS status,
      t.source_document_id::text AS source_document_id,
      COALESCE((
        SELECT SUM(p.amount_paise) FROM postings p
        WHERE p.transaction_id = t.id AND p.side = 'debit'
      ), 0)::text AS amount
    FROM transactions t
    WHERE t.kind = 'client_payment_received'
      AND t.related_entity_id = ${parsed}
      AND t.reverses_id IS NULL
    ORDER BY t.txn_date DESC, t.created_at DESC
  `);

  const allocRows = await db.execute<{
    payment_txn_id: string;
    invoice_txn_id: string;
    external_ref: string;
    project_id: string | null;
    project_name: string | null;
    allocated: string;
    remaining: string;
  }>(sql`
    SELECT
      ra.client_payment_txn_id::text AS payment_txn_id,
      it.id::text AS invoice_txn_id,
      it.external_ref,
      it.project_id::text AS project_id,
      pr.name AS project_name,
      ra.amount_paise::text AS allocated,
      (
        COALESCE((
          SELECT SUM(p.amount_paise) FROM postings p
          JOIN accounts a ON a.id = p.account_id
          WHERE p.transaction_id = it.id AND p.side = 'debit' AND a.code = '1200'
        ), 0)
        - COALESCE((SELECT SUM(amount_paise) FROM receipt_allocations x WHERE x.client_invoice_txn_id = it.id), 0)
      )::text AS remaining
    FROM receipt_allocations ra
    JOIN transactions it ON it.id = ra.client_invoice_txn_id
    LEFT JOIN projects pr ON pr.id = it.project_id
    WHERE ra.client_payment_txn_id IN (
      SELECT id FROM transactions
      WHERE kind = 'client_payment_received' AND related_entity_id = ${parsed} AND reverses_id IS NULL
    )
  `);

  const allocByPayment = new Map<string, ClientReceiptAllocationRow[]>();
  for (const a of Array.isArray(allocRows) ? allocRows : []) {
    const list = allocByPayment.get(a.payment_txn_id) ?? [];
    list.push({
      invoiceId: a.invoice_txn_id,
      invoiceDocumentNumber: invoiceDocNumber(a.external_ref),
      projectId: a.project_id,
      projectName: a.project_name,
      allocatedPaise: BigInt(a.allocated ?? '0'),
      remainingOnInvoicePaise: BigInt(a.remaining ?? '0'),
    });
    allocByPayment.set(a.payment_txn_id, list);
  }

  return (Array.isArray(paymentRows) ? paymentRows : []).map((p) => ({
    transactionId: p.id,
    externalRef: p.external_ref,
    txnDate: p.txn_date,
    status: p.status,
    amountPaise: BigInt(p.amount ?? '0'),
    sourceDocumentId: p.source_document_id,
    allocations: allocByPayment.get(p.id) ?? [],
  }));
}

export type OpenInvoiceRow = {
  invoiceId: string;
  invoiceTxnId: string;
  documentNumber: string;
  documentDate: string;
  projectId: string | null;
  projectName: string | null;
  totalPaise: bigint;
  outstandingPaise: bigint;
};

/** Open client_invoice txns (outstanding > 0) for the allocation picker. */
export async function listOpenInvoicesForClient(
  clientId: string,
): Promise<readonly OpenInvoiceRow[]> {
  await getActorContext();
  const parsed = z.string().uuid().parse(clientId);

  const rows = await db.execute<{
    invoice_txn_id: string;
    external_ref: string;
    document_date: string;
    project_id: string | null;
    project_name: string | null;
    total: string;
    outstanding: string;
  }>(sql`
    SELECT
      t.id::text AS invoice_txn_id,
      t.external_ref,
      t.txn_date::text AS document_date,
      t.project_id::text AS project_id,
      pr.name AS project_name,
      COALESCE((
        SELECT SUM(p.amount_paise) FROM postings p
        JOIN accounts a ON a.id = p.account_id
        WHERE p.transaction_id = t.id AND p.side = 'debit' AND a.code = '1200'
      ), 0)::text AS total,
      (
        COALESCE((
          SELECT SUM(p.amount_paise) FROM postings p
          JOIN accounts a ON a.id = p.account_id
          WHERE p.transaction_id = t.id AND p.side = 'debit' AND a.code = '1200'
        ), 0)
        - COALESCE((SELECT SUM(amount_paise) FROM receipt_allocations WHERE client_invoice_txn_id = t.id), 0)
      )::bigint AS outstanding
    FROM transactions t
    LEFT JOIN projects pr ON pr.id = t.project_id
    WHERE t.kind = 'client_invoice'
      AND t.status = 'posted'
      AND t.reverses_id IS NULL
      AND t.related_entity_id = ${parsed}
    ORDER BY t.txn_date ASC, t.created_at ASC
  `);

  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      invoiceId: r.invoice_txn_id,
      invoiceTxnId: r.invoice_txn_id,
      documentNumber: invoiceDocNumber(r.external_ref),
      documentDate: r.document_date,
      projectId: r.project_id,
      projectName: r.project_name,
      totalPaise: BigInt(r.total ?? '0'),
      outstandingPaise: BigInt(r.outstanding ?? '0'),
    }))
    .filter((r) => r.outstandingPaise > 0n);
}

export type ReceivableByProjectRow = {
  projectId: string | null;
  projectName: string | null;
  outstandingPaise: bigint;
};

/** "Due to collect" grouped by project — outstanding receivable per project,
 * plus `creditPaise`: the amount by which this client has OVERPAID us (net
 * Trade Receivables in credit), i.e. balance available with us. */
export async function getClientReceivablesByProject(clientId: string): Promise<{
  rows: readonly ReceivableByProjectRow[];
  totalPaise: bigint;
  creditPaise: bigint;
}> {
  await getActorContext();
  const parsed = z.string().uuid().parse(clientId);

  const rows = await db.execute<{
    project_id: string | null;
    project_name: string | null;
    outstanding: string;
  }>(sql`
    WITH inv AS (
      SELECT
        t.project_id,
        (
          COALESCE((
            SELECT SUM(p.amount_paise) FROM postings p
            JOIN accounts a ON a.id = p.account_id
            WHERE p.transaction_id = t.id AND p.side = 'debit' AND a.code = '1200'
          ), 0)
          - COALESCE((SELECT SUM(amount_paise) FROM receipt_allocations WHERE client_invoice_txn_id = t.id), 0)
        )::bigint AS outstanding
      FROM transactions t
      WHERE t.kind = 'client_invoice'
        AND t.status = 'posted'
        AND t.reverses_id IS NULL
        AND t.related_entity_id = ${parsed}
    )
    SELECT
      inv.project_id::text AS project_id,
      pr.name AS project_name,
      COALESCE(SUM(inv.outstanding), 0)::text AS outstanding
    FROM inv
    LEFT JOIN projects pr ON pr.id = inv.project_id
    GROUP BY inv.project_id, pr.name
    HAVING COALESCE(SUM(inv.outstanding), 0) > 0
    ORDER BY COALESCE(SUM(inv.outstanding), 0) DESC
  `);

  const mapped = (Array.isArray(rows) ? rows : []).map((r) => ({
    projectId: r.project_id,
    projectName: r.project_name,
    outstandingPaise: BigInt(r.outstanding ?? '0'),
  }));
  const totalPaise = mapped.reduce((acc, r) => acc + r.outstandingPaise, 0n);

  // Net Trade Receivables (1200) position for the client, from the ledger:
  // Σ credits (payments/credit notes) − Σ debits (invoices). Positive = they've
  // paid more than billed → that surplus is a credit balance available with us.
  const creditRows = await db.execute<{ net_credit: string }>(sql`
    SELECT COALESCE(SUM(
      CASE WHEN p.side = 'credit' THEN p.amount_paise ELSE -p.amount_paise END
    ), 0)::text AS net_credit
    FROM postings p
    JOIN accounts a ON a.id = p.account_id
    JOIN transactions t ON t.id = p.transaction_id
    WHERE a.code = '1200'
      AND p.subledger_entity_type = 'client'
      AND p.subledger_entity_id = ${parsed}
      AND t.status = 'posted'
      AND t.reverses_id IS NULL
  `);
  const netCredit = BigInt((Array.isArray(creditRows) ? creditRows : [])[0]?.net_credit ?? '0');
  const creditPaise = netCredit > 0n ? netCredit : 0n;

  return { rows: mapped, totalPaise, creditPaise };
}
