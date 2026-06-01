'use server';

import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { documents, entityDocuments, transactions } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { getActorContext } from '@/lib/server/actor';
import { createDraftTransaction } from '@/lib/server/ledger/transactions';
import type { VendorBillInput } from '@/lib/server/ledger/postings/vendorBill';

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
