'use server';

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { accounts, documents, entityDocuments, postings, projects, transactions } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { getActorContext } from '@/lib/server/actor';
import { createDraftTransaction } from '@/lib/server/ledger/transactions';
import { runValidations } from '@/lib/server/ledger/validation';
import { vendorBill, type VendorBillInput } from '@/lib/server/ledger/postings/vendorBill';

const VENDOR_BILL_KIND = 'vendor_bill';

/**
 * Vendor bill capture — the §0.6 "client attribution is sacred" entry
 * point. Reachable from BOTH client-side (Expenses-on-behalf tab,
 * attribution pre-locked to 'client') AND vendor-side (Bills tab,
 * attribution picker shown). The underlying `vendor_bill` posting
 * template + DB triggers guarantee that one row in `transactions` is
 * created either way, so both surfaces see the same record (SPEC §7.2).
 *
 * Reads:
 *   - listVendorBillsForClient(clientId)  → filtered to attribution=client
 *   - listVendorBillsForVendor(vendorId)  → all bills from this vendor
 *
 * Writes:
 *   - createVendorBillDraft(input)        → draft, returns flags
 */

export type VendorBillRow = {
  id: string;
  reference: string;
  vendorInvoiceNumber: string | null;
  txnDate: string;
  status: 'draft' | 'pending_approval' | 'posted' | 'reversed' | 'void';
  attribution: 'client' | 'opex' | 'asset';
  amountPaise: bigint;
  vendorId: string | null;
  onBehalfOfClientId: string | null;
  projectId: string | null;
  description: string | null;
  flags: { blocks: number; warnings: number };
};

function rowsToBills<
  T extends {
    id: string;
    externalRef: string;
    txnDate: string;
    status: 'draft' | 'pending_approval' | 'posted' | 'reversed' | 'void';
    paidToVendorId: string | null;
    onBehalfOfClientId: string | null;
    projectId: string | null;
    description: string | null;
    validationFlags: unknown;
    amountPaiseText: string;
    attribution: string;
  },
>(rs: readonly T[]): readonly VendorBillRow[] {
  return rs.map((r): VendorBillRow => {
    const fl = (r.validationFlags ?? []) as Array<{ severity?: string }>;
    const attribution = r.attribution as 'client' | 'opex' | 'asset' | string;
    return {
      id: r.id,
      reference: r.externalRef,
      vendorInvoiceNumber: r.externalRef.split(':')[2] ?? null,
      txnDate: r.txnDate,
      status: r.status,
      attribution: (['client', 'opex', 'asset'].includes(attribution) ? attribution : 'opex') as
        | 'client'
        | 'opex'
        | 'asset',
      amountPaise: BigInt(r.amountPaiseText),
      vendorId: r.paidToVendorId,
      onBehalfOfClientId: r.onBehalfOfClientId,
      projectId: r.projectId,
      description: r.description,
      flags: {
        blocks: fl.filter((f) => f?.severity === 'block').length,
        warnings: fl.filter((f) => f?.severity === 'warn').length,
      },
    };
  });
}

/** Attribution is captured on the first debit posting's metadata; pull it via subquery. */
const attributionSubquery = sql<string>`
  (select coalesce(metadata->>'attribution', 'opex') from postings
    where postings.transaction_id = transactions.id
      and postings.side = 'debit'
    order by amount_paise desc
    limit 1)
`;

const amountSubquery = sql<string>`
  (select coalesce(sum(amount_paise), 0)::text from postings
    where postings.transaction_id = transactions.id
      and postings.side = 'debit')
`;

export async function listVendorBillsForClient(
  clientId: string,
): Promise<readonly VendorBillRow[]> {
  await getActorContext();
  const rs = await db
    .select({
      id: transactions.id,
      externalRef: transactions.externalRef,
      txnDate: transactions.txnDate,
      status: transactions.status,
      paidToVendorId: transactions.paidToVendorId,
      onBehalfOfClientId: transactions.onBehalfOfClientId,
      projectId: transactions.projectId,
      description: transactions.description,
      validationFlags: transactions.validationFlags,
      amountPaiseText: amountSubquery,
      attribution: attributionSubquery,
    })
    .from(transactions)
    .where(and(eq(transactions.kind, 'vendor_bill'), eq(transactions.onBehalfOfClientId, clientId)))
    .orderBy(desc(transactions.txnDate))
    .limit(200);
  return rowsToBills(rs);
}

export async function listVendorBillsForVendor(
  vendorId: string,
): Promise<readonly VendorBillRow[]> {
  await getActorContext();
  const rs = await db
    .select({
      id: transactions.id,
      externalRef: transactions.externalRef,
      txnDate: transactions.txnDate,
      status: transactions.status,
      paidToVendorId: transactions.paidToVendorId,
      onBehalfOfClientId: transactions.onBehalfOfClientId,
      projectId: transactions.projectId,
      description: transactions.description,
      validationFlags: transactions.validationFlags,
      amountPaiseText: amountSubquery,
      attribution: attributionSubquery,
    })
    .from(transactions)
    .where(and(eq(transactions.kind, 'vendor_bill'), eq(transactions.paidToVendorId, vendorId)))
    .orderBy(desc(transactions.txnDate))
    .limit(200);
  return rowsToBills(rs);
}

/* -------------------------------------------------------------------------- */
/* Create draft                                                                */
/* -------------------------------------------------------------------------- */

const LineSchema = z.object({
  description: z.string().min(1).max(200),
  amountPaise: z.bigint().positive(),
  gstAmountPaiseCaptured: z.bigint().default(0n),
});

const VendorBillFormSchema = z.discriminatedUnion('attribution', [
  z.object({
    attribution: z.literal('client'),
    vendorId: z.string().uuid(),
    onBehalfOfClientId: z.string().uuid(),
    projectId: z.string().uuid().nullable().optional(),
    billDocumentId: z.string().uuid(),
    vendorInvoiceNumber: z.string().min(1).max(60),
    txnDate: z.string(),
    lineItems: z.array(LineSchema).min(1).max(50),
    tdsAmountPaise: z.bigint().default(0n),
    tdsSection: z.string().optional(),
    isRcm: z.boolean().default(false),
    notes: z.string().max(2000).optional().nullable(),
  }),
  z.object({
    attribution: z.literal('opex'),
    vendorId: z.string().uuid(),
    expenseAccountCode: z.enum(['6100', '6200', '6300', '6400', '6900', '8100']),
    billDocumentId: z.string().uuid(),
    vendorInvoiceNumber: z.string().min(1).max(60),
    txnDate: z.string(),
    lineItems: z.array(LineSchema).min(1).max(50),
    tdsAmountPaise: z.bigint().default(0n),
    tdsSection: z.string().optional(),
    isRcm: z.boolean().default(false),
    notes: z.string().max(2000).optional().nullable(),
  }),
  z.object({
    attribution: z.literal('asset'),
    vendorId: z.string().uuid(),
    billDocumentId: z.string().uuid(),
    vendorInvoiceNumber: z.string().min(1).max(60),
    txnDate: z.string(),
    lineItems: z.array(LineSchema).min(1).max(50),
    isRcm: z.boolean().default(false),
    notes: z.string().max(2000).optional().nullable(),
  }),
]);

export type VendorBillFormInput = z.infer<typeof VendorBillFormSchema>;

export async function createVendorBillDraft(input: VendorBillFormInput): Promise<{
  transactionId: string;
  flags: ReadonlyArray<{ code: string; severity: string; message: string }>;
}> {
  const ctx = await getActorContext();
  const parsed = VendorBillFormSchema.parse(input);

  // A project tagged on a client-attributed bill must belong to that client —
  // otherwise a client's project P&L would absorb another client's spend.
  if (parsed.attribution === 'client' && parsed.projectId) {
    const [p] = await db
      .select({ clientId: projects.clientId })
      .from(projects)
      .where(and(eq(projects.id, parsed.projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!p) throw new AppError('validation', 'The selected project no longer exists.');
    if (p.clientId !== parsed.onBehalfOfClientId) {
      throw new AppError('validation', 'The selected project belongs to a different client.');
    }
  }

  try {
    const result = await createDraftTransaction(ctx, {
      kind: 'vendor_bill',
      input: parsed as VendorBillInput,
    });

    // Mirror the bill's source document onto the vendor side. When
    // attribution='client', the user picks the doc out of the CLIENT's
    // Documents tab (that's where the bill PDF was uploaded), so without
    // this link the same doc never appears under the vendor — even
    // though the bill itself shows on both sides. SPEC-AMENDMENT-001 §7.2
    // says the bill record is shared between the two surfaces; the
    // source doc should be too.
    //
    // Idempotent: skip if an entity_documents row already links this
    // (vendor, document_id) pair.
    await mirrorBillDocToVendor({
      ctx,
      vendorId: parsed.vendorId,
      documentId: parsed.billDocumentId,
    });

    return { transactionId: result.transactionId, flags: result.validationFlags };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(
      'internal',
      e instanceof Error ? e.message : 'Failed to create vendor bill draft',
    );
  }
}

/**
 * Ensure the bill's source document also has an entity_documents row
 * under the vendor. Kept as a separate helper so the linker can be
 * reused by future "Pay vendor bill" / "Reverse bill" actions that
 * accept the same source doc.
 *
 * The new link uses the document's *own* kind when set ('invoice' /
 * 'receipt' / 'expense_receipt') so the vendor's Documents tab shows
 * it with the right badge — falling back to 'invoice' (matches the
 * doc-kind comment "vendor's invoice TO us") for legacy docs whose
 * category column is null.
 */
async function mirrorBillDocToVendor({
  ctx,
  vendorId,
  documentId,
}: {
  ctx: Awaited<ReturnType<typeof getActorContext>>;
  vendorId: string;
  documentId: string;
}): Promise<void> {
  // Skip if the link already exists.
  const existing = await db
    .select({ id: entityDocuments.id })
    .from(entityDocuments)
    .where(
      and(
        eq(entityDocuments.entityType, 'vendor'),
        eq(entityDocuments.entityId, vendorId),
        eq(entityDocuments.documentId, documentId),
      ),
    )
    .limit(1);
  if (existing[0]) return;

  // Resolve the document's stored kind so the vendor-side link matches
  // it (so the Documents tab shows the right kind badge).
  const docRows = await db
    .select({ category: documents.category })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  const rawKind = docRows[0]?.category ?? null;
  const allowedKinds = new Set([
    'contract',
    'msa',
    'sow',
    'nda',
    'offer_letter',
    'separation_letter',
    'kyc_pan',
    'kyc_aadhaar',
    'kyc_passport',
    'kyc_voter_id',
    'kyc_driving_license',
    'cancelled_cheque',
    'bank_statement',
    'invoice',
    'receipt',
    'payslip',
    'salary_sheet',
    'reimbursement_receipt',
    'expense_receipt',
    'photo',
    'other',
  ]);
  const kind = rawKind && allowedKinds.has(rawKind) ? rawKind : 'invoice';

  await db.insert(entityDocuments).values({
    entityType: 'vendor',
    entityId: vendorId,
    documentId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    kind: kind as any,
    // No new title needed — DocumentList falls back to documents.original_filename.
    version: 1,
    status: 'active',
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
  });
}

/* -------------------------------------------------------------------------- */
/* Edit / delete a DRAFT vendor bill                                           */
/* -------------------------------------------------------------------------- */
//
// Mirrors the client-invoice draft surface (client-transactions.ts). A vendor
// bill is a `vendor_bill` transaction; while it is a DRAFT it is fully editable
// and deletable (LEDGER-SPEC §0.3/§8.5 + migration 0015). Posted/reversed bills
// are immutable and must be reversed instead — enforced here AND by the ledger
// triggers as a backstop.

/**
 * Replace a draft vendor bill in place: re-derive the postings from the new
 * inputs, re-run validations, swap the postings, and update the header. Refuses
 * anything that isn't a `vendor_bill` in `draft` status.
 */
export async function updateVendorBillDraft(
  transactionId: string,
  input: VendorBillFormInput,
): Promise<{
  transactionId: string;
  flags: ReadonlyArray<{ code: string; severity: string; message: string }>;
}> {
  const ctx = await getActorContext();
  const parsed = VendorBillFormSchema.parse(input);

  // Same guard as create: a project tagged on a client bill must belong to
  // that client, or one client's P&L would absorb another's spend.
  if (parsed.attribution === 'client' && parsed.projectId) {
    const [p] = await db
      .select({ clientId: projects.clientId })
      .from(projects)
      .where(and(eq(projects.id, parsed.projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!p) throw new AppError('validation', 'The selected project no longer exists.');
    if (p.clientId !== parsed.onBehalfOfClientId) {
      throw new AppError('validation', 'The selected project belongs to a different client.');
    }
  }

  const template = vendorBill(parsed as VendorBillInput);
  const flags = await runValidations(template, {
    kind: VENDOR_BILL_KIND,
    attribution: parsed.attribution,
  });

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: transactions.id, status: transactions.status, kind: transactions.kind })
        .from(transactions)
        .where(eq(transactions.id, transactionId))
        .limit(1);
      if (!existing) throw new AppError('not_found', `Bill ${transactionId} not found`);
      if (existing.kind !== VENDOR_BILL_KIND) {
        throw new AppError('validation', `Transaction ${transactionId} is not a vendor bill`);
      }
      if (existing.status !== 'draft') {
        throw new AppError(
          'ledger.posted_immutable',
          `This bill is ${existing.status}, not a draft — reverse it instead of editing.`,
        );
      }

      // Resolve account codes via inArray (raw `= ANY(...)` mis-binds — see
      // the note in createDraftTransaction).
      const codes = Array.from(new Set(template.postings.map((pp) => pp.accountCode)));
      const accountRows = await tx
        .select({ id: accounts.id, code: accounts.code })
        .from(accounts)
        .where(inArray(accounts.code, codes));
      const codeToId = new Map(accountRows.map((a) => [a.code, a.id]));
      for (const code of codes) {
        if (!codeToId.has(code)) {
          throw new AppError('ledger.control_violation', `account code "${code}" not found`);
        }
      }

      await tx.delete(postings).where(eq(postings.transactionId, transactionId));
      await tx
        .update(transactions)
        .set({
          externalRef: template.externalRef,
          description: template.description,
          txnDate: template.txnDate,
          sourceKind: template.sourceKind,
          sourceDocumentId: template.sourceDocumentId,
          relatedEntityKind: template.relatedEntityKind,
          relatedEntityId: template.relatedEntityId,
          // Explicitly null the client-only tags when attribution changed away
          // from 'client' (a draft can switch client → opex/asset on edit).
          onBehalfOfClientId: template.onBehalfOfClientId ?? null,
          paidToVendorId: template.paidToVendorId ?? null,
          incurredByEmployeeId: template.incurredByEmployeeId ?? null,
          projectId: template.projectId ?? null,
          validationFlags: flags,
          notes: template.notes ?? null,
          updatedBy: ctx.userId,
        })
        .where(eq(transactions.id, transactionId));

      for (const pp of template.postings) {
        await tx.insert(postings).values({
          transactionId,
          accountId: codeToId.get(pp.accountCode)!,
          subledgerEntityType: pp.subledger?.entityType,
          subledgerEntityId: pp.subledger?.entityId,
          side: pp.side,
          amountPaise: pp.amountPaise,
          currency: 'INR',
          metadata: pp.metadata ?? {},
        });
      }
    });

    // Re-mirror the (possibly changed) source document onto the vendor. Idempotent.
    await mirrorBillDocToVendor({
      ctx,
      vendorId: parsed.vendorId,
      documentId: parsed.billDocumentId,
    });

    return {
      transactionId,
      flags: flags.map((f) => ({ code: f.code, severity: f.severity, message: f.message })),
    };
  } catch (e) {
    // DIAG (temporary): surface the raw DB/error message as a returned flag so
    // it isn't stripped by Next's production error masking. Revert after use.
    const dbg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { transactionId, flags: [{ code: 'debug', severity: 'info', message: `DBGERR::${dbg}` }] };
  }
}

/**
 * Delete a draft vendor bill (transaction + its postings). Refuses non-draft
 * bills. The uploaded source document and its vendor-side link are left intact —
 * the PDF is a legitimate vendor document independent of the bill.
 */
export async function deleteVendorBillDraft(transactionId: string): Promise<void> {
  await getActorContext();
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: transactions.id, status: transactions.status, kind: transactions.kind })
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .limit(1);
    if (!existing) throw new AppError('not_found', `Bill ${transactionId} not found`);
    if (existing.kind !== VENDOR_BILL_KIND) {
      throw new AppError('validation', `Transaction ${transactionId} is not a vendor bill`);
    }
    if (existing.status !== 'draft') {
      throw new AppError(
        'ledger.posted_immutable',
        `This bill is ${existing.status}, not a draft — reverse it instead of deleting.`,
      );
    }
    // postings.transaction_id is ON DELETE RESTRICT — remove children first.
    await tx.delete(postings).where(eq(postings.transactionId, transactionId));
    await tx.delete(transactions).where(eq(transactions.id, transactionId));
  });
}

export type DraftVendorBillFormShape = {
  transactionId: string;
  attribution: 'client' | 'opex' | 'asset';
  vendorId: string;
  onBehalfOfClientId: string | null;
  projectId: string | null;
  /** For opex bills: the 6xxx/8100 expense account code. */
  expenseAccountCode: string | null;
  billDocumentId: string;
  billDocumentName: string | null;
  vendorInvoiceNumber: string;
  txnDate: string;
  lineItems: ReadonlyArray<{
    description: string;
    amountPaise: bigint;
    gstAmountPaiseCaptured: bigint;
  }>;
  tdsAmountPaise: bigint;
  tdsSection: string | null;
  isRcm: boolean;
  notes: string | null;
};

/**
 * Load a draft vendor bill in the exact shape the form needs to pre-fill.
 * Postings carry only aggregated totals, so the per-line breakdown is read
 * back from the net-debit posting's `metadata.line_items` stash (written by
 * the vendorBill template); older drafts fall back to a single aggregated line.
 */
export async function getDraftVendorBill(
  transactionId: string,
): Promise<DraftVendorBillFormShape> {
  await getActorContext();

  const [txn] = await db
    .select({
      id: transactions.id,
      status: transactions.status,
      kind: transactions.kind,
      externalRef: transactions.externalRef,
      txnDate: transactions.txnDate,
      sourceDocumentId: transactions.sourceDocumentId,
      onBehalfOfClientId: transactions.onBehalfOfClientId,
      paidToVendorId: transactions.paidToVendorId,
      projectId: transactions.projectId,
      notes: transactions.notes,
    })
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .limit(1);
  if (!txn) throw new AppError('not_found', `Bill ${transactionId} not found`);
  if (txn.kind !== VENDOR_BILL_KIND) {
    throw new AppError('validation', `Transaction ${transactionId} is not a vendor bill`);
  }
  if (txn.status !== 'draft') {
    throw new AppError(
      'ledger.posted_immutable',
      `This bill is ${txn.status}, not a draft — reverse it instead of editing.`,
    );
  }
  if (!txn.sourceDocumentId) {
    throw new AppError('validation', 'Draft bill has no source document');
  }

  const vendorId = txn.paidToVendorId ?? '';
  // externalRef: `vendor_bill:<vendorId>:<invoiceNumber>` — the invoice number
  // may itself contain ':' so strip the exact prefix rather than split.
  const refPrefix = `vendor_bill:${vendorId}:`;
  const vendorInvoiceNumber = txn.externalRef.startsWith(refPrefix)
    ? txn.externalRef.slice(refPrefix.length)
    : txn.externalRef;

  const postingRows = await db
    .select({
      accountCode: accounts.code,
      side: postings.side,
      amountPaise: postings.amountPaise,
      metadata: postings.metadata,
    })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(eq(postings.transactionId, transactionId));

  // The net-debit posting is the debit that isn't the 1250 GST-input line; it
  // carries attribution + is_rcm + the line-item stash. Its account code is the
  // expense account (opex) / 5100 (client) / 1510 (asset).
  const netPosting = postingRows.find((pp) => pp.side === 'debit' && pp.accountCode !== '1250');
  const gstPosting = postingRows.find((pp) => pp.side === 'debit' && pp.accountCode === '1250');
  const tdsPosting = postingRows.find((pp) => pp.side === 'credit' && pp.accountCode === '2130');

  const netMeta = (netPosting?.metadata ?? {}) as Record<string, unknown>;
  const attributionRaw =
    typeof netMeta['attribution'] === 'string' ? (netMeta['attribution'] as string) : 'opex';
  const attribution = (
    ['client', 'opex', 'asset'].includes(attributionRaw) ? attributionRaw : 'opex'
  ) as 'client' | 'opex' | 'asset';
  const isRcm = netMeta['is_rcm'] === true;
  const expenseAccountCode = attribution === 'opex' ? (netPosting?.accountCode ?? null) : null;

  type LineMeta = {
    description?: string;
    amount_paise?: string;
    gst_amount_paise_captured?: string;
  };
  const stashed = Array.isArray(netMeta['line_items']) ? (netMeta['line_items'] as LineMeta[]) : null;
  let lineItems: DraftVendorBillFormShape['lineItems'];
  if (stashed && stashed.length > 0) {
    lineItems = stashed.map((l) => ({
      description: typeof l.description === 'string' ? l.description : '',
      amountPaise: l.amount_paise ? BigInt(l.amount_paise) : 0n,
      gstAmountPaiseCaptured: l.gst_amount_paise_captured ? BigInt(l.gst_amount_paise_captured) : 0n,
    }));
  } else {
    lineItems = [
      {
        description: '(aggregated line — original breakdown not recorded)',
        amountPaise: netPosting?.amountPaise ?? 0n,
        gstAmountPaiseCaptured: gstPosting?.amountPaise ?? 0n,
      },
    ];
  }

  const tdsMeta = (tdsPosting?.metadata ?? {}) as Record<string, unknown>;
  const tdsSection =
    typeof tdsMeta['tds_section'] === 'string' ? (tdsMeta['tds_section'] as string) : null;

  const [doc] = await db
    .select({ name: documents.originalFilename })
    .from(documents)
    .where(eq(documents.id, txn.sourceDocumentId))
    .limit(1);

  return {
    transactionId: txn.id,
    attribution,
    vendorId,
    onBehalfOfClientId: txn.onBehalfOfClientId ?? null,
    projectId: txn.projectId ?? null,
    expenseAccountCode,
    billDocumentId: txn.sourceDocumentId,
    billDocumentName: doc?.name ?? null,
    vendorInvoiceNumber,
    txnDate: txn.txnDate,
    lineItems,
    tdsAmountPaise: tdsPosting?.amountPaise ?? 0n,
    tdsSection,
    isRcm,
    notes: txn.notes ?? null,
  };
}
