'use server';

import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { accounts, documents, postings, transactions } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { getActorContext } from '@/lib/server/actor';
import { createDraftTransaction } from '@/lib/server/ledger/transactions';
import { clientInvoice } from '@/lib/server/ledger/postings/clientInvoice';

/**
 * Per-client transaction list + minimal invoice-creation wrapper. The
 * underlying ledger orchestrator (`lib/server/ledger/transactions`) does
 * the actual validation + posting; this file just narrows the entry
 * surface to "client-side" transactions and shapes the output for the
 * shared <TransactionList> component.
 *
 * Open follow-ups (BACKEND-STATE §11):
 *   - createClientPaymentReceived
 *   - createClientAdvanceReceived
 *   - getStatementOfAccount (running balance per client)
 */

export type ClientTransactionRow = {
  id: string;
  reference: string;
  kind: string;
  date: string;
  amountPaise: bigint;
  status: 'draft' | 'pending_approval' | 'posted' | 'reversed' | 'void';
  memo: string | null;
  /** Block + warn counts derived from validation_flags JSONB. */
  flags: { blocks: number; warnings: number };
};

/**
 * Returns every transaction touching this client — either as related
 * entity (e.g. an invoice we issued to them) or via on_behalf_of_client_id
 * (e.g. a vendor bill we paid on their behalf). The Expenses-on-behalf
 * tab will filter this further to kind=vendor_bill.
 */
export async function listClientTransactions(
  clientId: string,
): Promise<readonly ClientTransactionRow[]> {
  await getActorContext();

  // Two-query approach: first the transaction headers, then one aggregate
  // round-trip for the headline amounts. Replaces the previous correlated
  // scalar-subquery (`amountPaise: sql<string>${...}`) — Drizzle's column
  // interpolation inside a sql tag wasn't reliably correlating with the
  // outer transactions table, so every row's amount came back as 0.
  const txnRows = await db
    .select({
      id: transactions.id,
      externalRef: transactions.externalRef,
      kind: transactions.kind,
      txnDate: transactions.txnDate,
      status: transactions.status,
      description: transactions.description,
      notes: transactions.notes,
      validationFlags: transactions.validationFlags,
    })
    .from(transactions)
    .where(
      or(
        and(
          eq(transactions.relatedEntityKind, 'client'),
          eq(transactions.relatedEntityId, clientId),
        ),
        eq(transactions.onBehalfOfClientId, clientId),
      ),
    )
    .orderBy(desc(transactions.txnDate))
    .limit(200);

  // Now sum debit-side postings per transaction. SUM(bigint) in PG returns
  // numeric — cast to text so we don't lose precision through any JS
  // number coercion, then BigInt() it on the way out.
  const txnIds = txnRows.map((r) => r.id);
  const amountRows =
    txnIds.length === 0
      ? []
      : await db
          .select({
            transactionId: postings.transactionId,
            totalPaise: sql<string>`COALESCE(SUM(${postings.amountPaise}), 0)::text`.as(
              'total_paise',
            ),
          })
          .from(postings)
          .where(and(inArray(postings.transactionId, txnIds), eq(postings.side, 'debit')))
          .groupBy(postings.transactionId);
  const amountByTxn = new Map<string, bigint>(
    amountRows.map((r) => [r.transactionId, BigInt(r.totalPaise)]),
  );

  return txnRows.map((r): ClientTransactionRow => {
    const flagsRaw = (r.validationFlags ?? []) as Array<{ severity?: string }>;
    const flags = {
      blocks: flagsRaw.filter((f) => f?.severity === 'block').length,
      warnings: flagsRaw.filter((f) => f?.severity === 'warn').length,
    };
    return {
      id: r.id,
      reference: r.externalRef,
      kind: r.kind,
      date: r.txnDate,
      amountPaise: amountByTxn.get(r.id) ?? 0n,
      status: r.status,
      memo: r.description ?? r.notes,
      flags,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Client invoice — create draft                                              */
/* -------------------------------------------------------------------------- */

const ClientInvoiceFormSchema = z.object({
  clientId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  invoiceDocumentId: z.string().uuid(),
  invoiceNumber: z.string().min(1).max(60),
  txnDate: z.string(), // YYYY-MM-DD
  lineItems: z
    .array(
      z.object({
        description: z.string().min(1).max(200),
        amountPaise: z.bigint().positive(),
        gstAmountPaiseCaptured: z.bigint().default(0n),
      }),
    )
    .min(1)
    .max(50),
  notes: z.string().max(2000).optional().nullable(),
});

export type ClientInvoiceFormInput = z.infer<typeof ClientInvoiceFormSchema>;

export type CreateClientInvoiceResult = {
  transactionId: string;
  flags: ReadonlyArray<{ code: string; severity: string; message: string }>;
};

export async function createClientInvoiceDraft(
  input: ClientInvoiceFormInput,
): Promise<CreateClientInvoiceResult> {
  const ctx = await getActorContext();
  const parsed = ClientInvoiceFormSchema.parse(input);

  // Optional capability gate — falls back to passing for partner / admin
  // who already have post_transaction. Manager+accountant can also create
  // drafts; the post step is what requires the capability.
  // (No requireCapability call here — createDraftTransaction in the
  // orchestrator gates per-kind via attribution + validation rules.)

  try {
    const result = await createDraftTransaction(ctx, {
      kind: 'client_invoice',
      input: {
        clientId: parsed.clientId,
        ...(parsed.projectId ? { projectId: parsed.projectId } : {}),
        invoiceDocumentId: parsed.invoiceDocumentId,
        invoiceNumber: parsed.invoiceNumber,
        txnDate: parsed.txnDate,
        lineItems: parsed.lineItems,
        ...(parsed.notes ? { notes: parsed.notes } : {}),
      },
    });
    return {
      transactionId: result.transactionId,
      flags: result.validationFlags,
    };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('internal', describeDbError(e, 'Failed to create draft invoice'));
  }
}

/**
 * Drizzle errors wrap the underlying PG / trigger error one (or two)
 * levels deep — their `.message` is just "Failed query: <SQL>
 * params: <values>" which is useless in a UI toast. Walk the `.cause`
 * chain to surface the real reason ("polymorphic FK violation: …",
 * "transaction <id> unbalanced: Dr=… Cr=…", trigger RAISE messages,
 * Zod validation failure, etc.) so the user can actually act on it.
 */
function describeDbError(e: unknown, fallback: string): string {
  if (!(e instanceof Error)) return fallback;
  let current: Error | undefined = e;
  let depth = 0;
  while (current && depth < 5) {
    const cause: unknown = (current as Error & { cause?: unknown }).cause;
    if (cause instanceof Error) {
      current = cause;
      depth += 1;
    } else {
      break;
    }
  }
  return current?.message ?? e.message ?? fallback;
}

/* -------------------------------------------------------------------------- */
/* Edit / discard a draft client invoice                                       */
/* -------------------------------------------------------------------------- */
//
// LEDGER-SPEC §0.3 + §8.5 lock POSTED transactions — drafts are pre-ledger
// and editable by the creator until they Post or Reverse. Migration 0015
// loosens the DB-level no-delete trigger to allow draft deletes; the two
// actions below are the application-side surface.

/**
 * Replace a draft client_invoice in place. Validates the row is still a
 * draft (you cannot edit posted/reversed transactions), then within one DB
 * transaction:
 *   1. Recomputes the postings via the clientInvoice template.
 *   2. Deletes the old postings (allowed for drafts per 0015).
 *   3. Updates the transaction header.
 *   4. Inserts the new postings.
 * Returns the same shape as createClientInvoiceDraft so the calling form
 * can route the result through its existing flag/toast pipeline.
 */
export async function updateClientInvoiceDraft(
  transactionId: string,
  input: ClientInvoiceFormInput,
): Promise<CreateClientInvoiceResult> {
  const ctx = await getActorContext();
  const parsed = ClientInvoiceFormSchema.parse(input);

  try {
    return await db.transaction(async (tx) => {
      // Verify the transaction exists and is still a draft.
      const existingRows = await tx
        .select({ id: transactions.id, status: transactions.status, kind: transactions.kind })
        .from(transactions)
        .where(eq(transactions.id, transactionId))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) {
        throw new AppError('not_found', `Transaction ${transactionId} not found`);
      }
      if (existing.status !== 'draft') {
        throw new AppError(
          'ledger.posted_immutable',
          `Transaction ${transactionId} is ${existing.status}, not draft. Reverse it instead.`,
        );
      }
      if (existing.kind !== 'client_invoice') {
        throw new AppError(
          'validation',
          `Transaction kind is ${existing.kind}, expected client_invoice`,
        );
      }

      // Build a fresh template from the new inputs.
      const template = clientInvoice({
        clientId: parsed.clientId,
        ...(parsed.projectId ? { projectId: parsed.projectId } : {}),
        invoiceDocumentId: parsed.invoiceDocumentId,
        invoiceNumber: parsed.invoiceNumber,
        txnDate: parsed.txnDate,
        lineItems: parsed.lineItems,
        ...(parsed.notes ? { notes: parsed.notes } : {}),
      });

      // Resolve account codes the same way createDraftTransaction does
      // (inArray, not raw `code = ANY (...)` — that bug bit us earlier).
      const codes = Array.from(new Set(template.postings.map((p) => p.accountCode)));
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

      // Drop the old postings and recreate from the new template.
      await tx.delete(postings).where(eq(postings.transactionId, transactionId));

      // Update the transaction header.
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
          onBehalfOfClientId: template.onBehalfOfClientId,
          paidToVendorId: template.paidToVendorId,
          incurredByEmployeeId: template.incurredByEmployeeId,
          projectId: template.projectId,
          notes: template.notes,
          updatedBy: ctx.userId,
        })
        .where(eq(transactions.id, transactionId));

      // Insert the new postings.
      for (const p of template.postings) {
        await tx.insert(postings).values({
          transactionId,
          accountId: codeToId.get(p.accountCode)!,
          subledgerEntityType: p.subledger?.entityType,
          subledgerEntityId: p.subledger?.entityId,
          side: p.side,
          amountPaise: p.amountPaise,
          currency: 'INR',
          metadata: p.metadata ?? {},
        });
      }

      return { transactionId, flags: [] };
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('internal', describeDbError(e, 'Failed to update draft invoice'));
  }
}

/**
 * Discard a draft transaction (any kind). Refuses anything that is not in
 * 'draft' status — posted / reversed transactions are immutable and must
 * be reversed, not deleted. The trigger in 0015 enforces the same rule at
 * the DB layer; this action just gives the UI a clean callsite.
 */
export async function discardDraftTransaction(transactionId: string): Promise<void> {
  await getActorContext();
  await db.transaction(async (tx) => {
    const existingRows = await tx
      .select({ id: transactions.id, status: transactions.status })
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) {
      throw new AppError('not_found', `Transaction ${transactionId} not found`);
    }
    if (existing.status !== 'draft') {
      throw new AppError(
        'ledger.posted_immutable',
        `Cannot discard a ${existing.status} transaction. Reverse it instead.`,
      );
    }
    // Delete postings first so the FK doesn't block the parent delete.
    await tx.delete(postings).where(eq(postings.transactionId, transactionId));
    await tx.delete(transactions).where(eq(transactions.id, transactionId));
  });
}

/* -------------------------------------------------------------------------- */
/* Pre-fill an Edit dialog                                                     */
/* -------------------------------------------------------------------------- */

export type DraftClientInvoiceFormShape = {
  transactionId: string;
  invoiceNumber: string;
  txnDate: string;
  invoiceDocumentId: string;
  /** documents.id resolved to the table's display fields for the picker. */
  invoiceDocumentName: string | null;
  notes: string | null;
  lineItems: ReadonlyArray<{
    description: string;
    amountPaise: bigint;
    gstAmountPaiseCaptured: bigint;
  }>;
};

/**
 * Load a draft client_invoice in the exact shape the form needs to pre-fill.
 *
 * Why per-kind: the inverse of clientInvoice() can't be expressed by reading
 * postings alone — those carry aggregated totals (1200 gross, 4100 net,
 * 2120 gst) rather than the per-line breakdown the user entered. The
 * template now stashes the original line items in the 4100 posting's
 * metadata.line_items; this reader parses them back, with a graceful fall-
 * back to a single aggregated line when an older draft (created before
 * the metadata-stash landed) is opened.
 */
export async function getDraftClientInvoice(
  transactionId: string,
): Promise<DraftClientInvoiceFormShape> {
  await getActorContext();

  const txnRows = await db
    .select({
      id: transactions.id,
      status: transactions.status,
      kind: transactions.kind,
      externalRef: transactions.externalRef,
      txnDate: transactions.txnDate,
      sourceDocumentId: transactions.sourceDocumentId,
      notes: transactions.notes,
    })
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .limit(1);
  const txn = txnRows[0];
  if (!txn) {
    throw new AppError('not_found', `Transaction ${transactionId} not found`);
  }
  if (txn.status !== 'draft') {
    throw new AppError(
      'ledger.posted_immutable',
      `Transaction ${transactionId} is ${txn.status}, not draft. Reverse it instead.`,
    );
  }
  if (txn.kind !== 'client_invoice') {
    throw new AppError('validation', `Transaction kind is ${txn.kind}, expected client_invoice`);
  }
  if (!txn.sourceDocumentId) {
    throw new AppError('validation', 'Draft has no source document');
  }

  // externalRef format: `client_invoice:<invoiceNumber>`
  const invoiceNumber = txn.externalRef.startsWith('client_invoice:')
    ? txn.externalRef.slice('client_invoice:'.length)
    : txn.externalRef;

  // Pull the 4100 posting + its line-item metadata. Also pull 2120 (GST)
  // and 4100 (net) totals so we can synthesise an aggregated line for
  // drafts saved before the metadata-stash existed.
  const postingsRows = await db
    .select({
      accountCode: accounts.code,
      amountPaise: postings.amountPaise,
      metadata: postings.metadata,
    })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(
      and(eq(postings.transactionId, transactionId), inArray(accounts.code, ['4100', '2120'])),
    );

  const revenuePosting = postingsRows.find((p) => p.accountCode === '4100');
  const gstPosting = postingsRows.find((p) => p.accountCode === '2120');

  let lineItems: DraftClientInvoiceFormShape['lineItems'] = [];
  type LineMeta = {
    description?: string;
    amount_paise?: string;
    gst_amount_paise_captured?: string;
  };
  const meta = (revenuePosting?.metadata ?? {}) as Record<string, unknown>;
  const stashed = Array.isArray(meta['line_items']) ? (meta['line_items'] as LineMeta[]) : null;

  if (stashed && stashed.length > 0) {
    lineItems = stashed.map((l) => ({
      description: typeof l.description === 'string' ? l.description : '',
      amountPaise: l.amount_paise ? BigInt(l.amount_paise) : 0n,
      gstAmountPaiseCaptured: l.gst_amount_paise_captured
        ? BigInt(l.gst_amount_paise_captured)
        : 0n,
    }));
  } else {
    // Legacy fallback: synthesise ONE row from the totals. The user can
    // re-split into multiple lines before saving.
    const netTotal = revenuePosting?.amountPaise ?? 0n;
    const gstTotal = gstPosting?.amountPaise ?? 0n;
    if (netTotal > 0n) {
      lineItems = [
        {
          description: '(aggregated line — original breakdown not recorded)',
          amountPaise: netTotal,
          gstAmountPaiseCaptured: gstTotal,
        },
      ];
    }
  }

  // Document display name — handy for the picker but we also pre-select the
  // option by id, so the form still works even if the row is gone.
  const docRows = await db
    .select({ name: documents.originalFilename })
    .from(documents)
    .where(eq(documents.id, txn.sourceDocumentId))
    .limit(1);
  const invoiceDocumentName = docRows[0]?.name ?? null;

  return {
    transactionId: txn.id,
    invoiceNumber,
    txnDate: txn.txnDate,
    invoiceDocumentId: txn.sourceDocumentId,
    invoiceDocumentName,
    notes: txn.notes,
    lineItems,
  };
}
