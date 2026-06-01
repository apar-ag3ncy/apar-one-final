'use server';

import { and, eq, sum } from 'drizzle-orm';
import { z } from 'zod';

import { db, type DbClient } from '@/lib/db/client';
import {
  entityDocuments,
  estimateInvoiceLinks,
  estimateLines,
  estimates,
  invoiceLines,
  invoices,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { logActivity } from '@/lib/activity';
import { logAudit } from '@/lib/audit';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

import { nextDocumentNumber, withNumberingRetry } from './numbering';

/**
 * Phase 3.2 — markEstimateAccepted(id, acceptanceDocumentId)
 *
 *   Caller has already uploaded the signed acceptance doc via the
 *   dashboard's uploadDocument flow (entity_documents row). This
 *   action only links the doc and flips state sent → accepted.
 *
 * Phase 3.3 — convertEstimateToInvoice(estimateId, { kind, value })
 *
 *   Creates a NEW invoice (state=draft) from the estimate per the
 *   conversion kind:
 *     - 'full'           — invoice covers the whole estimate
 *     - 'partial_pct'    — value = basis points (5000 = 50%)
 *     - 'partial_amount' — value = paise to invoice
 *     - 'partial_lines'  — value = lineNo[] from the estimate
 *
 *   Inserts an estimate_invoice_links row capturing the conversion.
 *   When the SUM of converted value reaches the estimate's captured
 *   total, the estimate state flips to 'converted' automatically.
 *
 *   No ledger interaction here either — the resulting invoice goes
 *   through the standard sendInvoice flow when the accountant is
 *   ready to issue it.
 */

const EstimateIdSchema = z.string().uuid();
const DocIdSchema = z.string().uuid();

/* -------------------------------------------------------------------------- */
/* 3.2 — markEstimateAccepted                                                 */
/* -------------------------------------------------------------------------- */

export async function markEstimateAccepted(
  estimateId: string,
  acceptanceDocumentId: string,
): Promise<{ id: string; state: 'accepted' }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_estimate');
  const parsedId = EstimateIdSchema.parse(estimateId);
  const parsedDoc = DocIdSchema.parse(acceptanceDocumentId);

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(estimates).where(eq(estimates.id, parsedId)).limit(1);
    if (!current) throw new AppError('not_found', `estimate ${parsedId} not found`);
    if (current.state === 'accepted') {
      return { id: parsedId, state: 'accepted' as const };
    }
    if (current.state !== 'sent') {
      throw new AppError(
        'validation',
        `estimate ${parsedId} is ${current.state}; only 'sent' can transition to 'accepted'.`,
      );
    }

    // Sanity-check that the doc exists and is tied to this estimate's client.
    const [doc] = await tx
      .select({
        id: entityDocuments.id,
        entityType: entityDocuments.entityType,
        entityId: entityDocuments.entityId,
      })
      .from(entityDocuments)
      .where(eq(entityDocuments.id, parsedDoc))
      .limit(1);
    if (!doc) {
      throw new AppError(
        'not_found',
        `acceptance document ${parsedDoc} not found in entity_documents — upload first.`,
      );
    }
    // Soft check — we don't refuse on a mismatched entity link because the
    // dashboard might attach the same signed PDF under different scopes
    // (project doc, client doc). We log it for visibility.

    await tx
      .update(estimates)
      .set({
        state: 'accepted',
        acceptedAt: new Date(),
        acceptanceDocId: parsedDoc,
        updatedBy: ctx.userId,
      })
      .where(eq(estimates.id, parsedId));

    await logActivity(
      {
        entityType: 'client',
        entityId: current.clientId,
        actorId: ctx.userId,
        kind: 'estimate.accepted',
        summary: `Estimate ${current.documentNumber} accepted`,
        payload: {
          estimate_id: parsedId,
          document_number: current.documentNumber,
          acceptance_document_id: parsedDoc,
          attached_to_entity_type: doc.entityType,
          attached_to_entity_id: doc.entityId,
        },
      },
      tx as unknown as typeof db,
    );

    await logAudit(
      {
        actorId: ctx.userId,
        entityType: 'estimate',
        entityId: parsedId,
        action: 'update',
        changes: {
          state: { before: 'sent', after: 'accepted' },
          acceptance_doc_id: { before: null, after: parsedDoc },
        },
      },
      tx as unknown as typeof db,
    );

    return { id: parsedId, state: 'accepted' as const };
  });
}

/* -------------------------------------------------------------------------- */
/* 3.3 — convertEstimateToInvoice                                             */
/* -------------------------------------------------------------------------- */

const ConvertKindSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('full') }),
  z.object({ kind: z.literal('partial_pct'), valueBps: z.number().int().positive().max(10000) }),
  z.object({ kind: z.literal('partial_amount'), valuePaise: z.bigint().positive() }),
  z.object({
    kind: z.literal('partial_lines'),
    lineNos: z.array(z.number().int().positive()).min(1),
  }),
]);

export type ConvertKind = z.input<typeof ConvertKindSchema>;

export type ConvertResult = {
  invoiceId: string;
  invoiceDocumentNumber: string;
  linkValuePaise: bigint;
  estimateFullyConverted: boolean;
};

export async function convertEstimateToInvoice(
  estimateId: string,
  conversion: ConvertKind,
  idempotencyKey: string,
): Promise<ConvertResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_estimate');
  const parsedId = EstimateIdSchema.parse(estimateId);
  const v = ConvertKindSchema.parse(conversion);
  const idemp = z.string().trim().min(8).max(200).parse(idempotencyKey);

  // Short-circuit on idempotency — same key returns the same invoice.
  const existing = await db
    .select({
      invoiceId: invoices.id,
      documentNumber: invoices.documentNumber,
      linkValuePaise: estimateInvoiceLinks.valuePaise,
    })
    .from(invoices)
    .leftJoin(estimateInvoiceLinks, eq(estimateInvoiceLinks.invoiceId, invoices.id))
    .where(eq(invoices.idempotencyKey, idemp))
    .limit(1);
  if (existing[0]) {
    const fullyConverted = await isEstimateFullyConverted(parsedId, db);
    return {
      invoiceId: existing[0].invoiceId,
      invoiceDocumentNumber: existing[0].documentNumber,
      linkValuePaise: existing[0].linkValuePaise ?? 0n,
      estimateFullyConverted: fullyConverted,
    };
  }

  return withNumberingRetry(async () =>
    db.transaction(async (tx) =>
      doConvert(tx as unknown as DbClient, ctx.userId, parsedId, v, idemp),
    ),
  );
}

async function doConvert(
  tx: DbClient,
  userId: string,
  estimateId: string,
  conversion: z.infer<typeof ConvertKindSchema>,
  idempotencyKey: string,
): Promise<ConvertResult> {
  const [estimate] = await tx.select().from(estimates).where(eq(estimates.id, estimateId)).limit(1);
  if (!estimate) throw new AppError('not_found', `estimate ${estimateId} not found`);
  if (estimate.state !== 'accepted') {
    throw new AppError(
      'validation',
      `estimate ${estimateId} is ${estimate.state}; must be 'accepted' to convert.`,
    );
  }

  const allLines = await tx
    .select()
    .from(estimateLines)
    .where(eq(estimateLines.estimateId, estimateId))
    .orderBy(estimateLines.lineNo);
  if (allLines.length === 0) {
    throw new AppError('validation', `estimate ${estimateId} has no lines.`);
  }

  // Build the invoice line set + the link's notional value (paise) based
  // on the conversion kind. For partial_pct / partial_amount we keep the
  // line set whole and scale; for partial_lines we pick a subset
  // verbatim. Captured tax values are scaled too (the user can refine
  // before sending, but the line totals reconcile out of the box).
  const { invoiceLinesValues, linkValuePaise } = buildInvoiceLines(estimate, allLines, conversion);

  // Allocate the next invoice number.
  const { documentNumber } = await nextDocumentNumber('invoice', estimate.financialYearStart, tx);

  // Compute the invoice header totals from the chosen lines (sum so the
  // numbers reconcile after partial scaling).
  const subtotal = invoiceLinesValues.reduce(
    (acc, l) => acc + (l.capturedTaxableValuePaise ?? 0n),
    0n,
  );
  const taxTotal = invoiceLinesValues.reduce(
    (acc, l) => acc + (l.capturedTaxAmountPaise ?? 0n),
    0n,
  );
  const grandTotal = subtotal + taxTotal;

  const [invRow] = await tx
    .insert(invoices)
    .values({
      documentNumber,
      documentDate: estimate.documentDate,
      dueDate: null,
      financialYearStart: estimate.financialYearStart,
      clientId: estimate.clientId,
      projectId: estimate.projectId,
      state: 'draft',
      subtotalPaise: subtotal,
      capturedTaxTotalPaise: taxTotal,
      capturedTotalPaise: grandTotal,
      placeOfSupply: estimate.placeOfSupply,
      // capturedTaxSplit is left empty here — partial scaling makes the
      // split assumptions invalid. The accountant fills it in before send.
      capturedTaxSplit: {},
      terms: estimate.terms,
      notes:
        (estimate.notes ?? '') +
        `\n[converted from estimate ${estimate.documentNumber} (${conversion.kind})]`,
      idempotencyKey,
      validationFlags: [],
      createdBy: userId,
      updatedBy: userId,
    })
    .returning({ id: invoices.id });
  if (!invRow) throw new AppError('internal', 'invoices.insert returned no row (conversion)');
  const invoiceId = invRow.id;

  await tx.insert(invoiceLines).values(
    invoiceLinesValues.map((l) => ({
      ...l,
      invoiceId,
      createdBy: userId,
      updatedBy: userId,
    })),
  );

  await tx.insert(estimateInvoiceLinks).values({
    estimateId,
    invoiceId,
    kind: conversion.kind,
    valuePctBps: conversion.kind === 'partial_pct' ? conversion.valueBps : null,
    valuePaise: linkValuePaise,
    createdBy: userId,
    updatedBy: userId,
  });

  // Flip the estimate to 'converted' if cumulative conversion value
  // reaches the captured total. Cheap aggregate against this estimate's
  // link rows.
  const fullyConverted = await isEstimateFullyConverted(estimateId, tx);
  if (fullyConverted) {
    await tx
      .update(estimates)
      .set({ state: 'converted', updatedBy: userId })
      .where(eq(estimates.id, estimateId));
  }

  await logActivity(
    {
      entityType: 'client',
      entityId: estimate.clientId,
      actorId: userId,
      kind: fullyConverted ? 'estimate.converted' : 'estimate.accepted',
      summary: fullyConverted
        ? `Estimate ${estimate.documentNumber} fully converted to invoice ${documentNumber}`
        : `Estimate ${estimate.documentNumber} partial-converted to invoice ${documentNumber}`,
      payload: {
        estimate_id: estimateId,
        invoice_id: invoiceId,
        invoice_document_number: documentNumber,
        kind: conversion.kind,
        link_value_paise: linkValuePaise.toString(),
        fully_converted: fullyConverted,
      },
    },
    tx as unknown as typeof db,
  );

  await logAudit(
    {
      actorId: userId,
      entityType: 'estimate',
      entityId: estimateId,
      action: 'update',
      changes: {
        conversion: { kind: conversion.kind, link_value_paise: linkValuePaise.toString() },
        ...(fullyConverted ? { state: { before: 'accepted', after: 'converted' } } : {}),
      },
    },
    tx as unknown as typeof db,
  );

  return {
    invoiceId,
    invoiceDocumentNumber: documentNumber,
    linkValuePaise,
    estimateFullyConverted: fullyConverted,
  };
}

function buildInvoiceLines(
  estimate: typeof estimates.$inferSelect,
  allLines: Array<typeof estimateLines.$inferSelect>,
  conversion: z.infer<typeof ConvertKindSchema>,
): {
  invoiceLinesValues: Array<
    Omit<typeof invoiceLines.$inferInsert, 'invoiceId' | 'createdBy' | 'updatedBy'>
  >;
  linkValuePaise: bigint;
} {
  if (conversion.kind === 'full') {
    return {
      invoiceLinesValues: allLines.map(toInvoiceLine),
      linkValuePaise: estimate.capturedTotalPaise,
    };
  }

  if (conversion.kind === 'partial_lines') {
    const wanted = new Set(conversion.lineNos);
    const picked = allLines.filter((l) => wanted.has(l.lineNo));
    if (picked.length === 0) {
      throw new AppError('validation', 'No matching lineNos found on the estimate.');
    }
    const linkValuePaise = picked.reduce(
      (acc, l) => acc + l.capturedTaxableValuePaise + l.capturedTaxAmountPaise,
      0n,
    );
    return {
      invoiceLinesValues: picked.map((l, idx) => ({ ...toInvoiceLine(l), lineNo: idx + 1 })),
      linkValuePaise,
    };
  }

  if (conversion.kind === 'partial_pct') {
    // Scale every line proportionally.
    const bps = BigInt(conversion.valueBps);
    return {
      invoiceLinesValues: allLines.map((l) => scaleLine(l, bps)),
      linkValuePaise: scaleBps(estimate.capturedTotalPaise, bps),
    };
  }

  // partial_amount — scale by the implied ratio (valuePaise / capturedTotalPaise).
  if (estimate.capturedTotalPaise === 0n) {
    throw new AppError('validation', 'Cannot partial_amount-convert a zero-total estimate.');
  }
  if (conversion.valuePaise > estimate.capturedTotalPaise) {
    throw new AppError(
      'validation',
      'partial_amount value exceeds estimate total. Use full conversion or reduce the value.',
    );
  }
  // bps = valuePaise / capturedTotalPaise * 10000, integer rounded.
  const bps = (conversion.valuePaise * 10000n) / estimate.capturedTotalPaise;
  return {
    invoiceLinesValues: allLines.map((l) => scaleLine(l, bps)),
    linkValuePaise: conversion.valuePaise,
  };
}

function scaleLine(
  l: typeof estimateLines.$inferSelect,
  bps: bigint,
): Omit<typeof invoiceLines.$inferInsert, 'invoiceId' | 'createdBy' | 'updatedBy'> {
  return {
    ...toInvoiceLine(l),
    ratePaise: scaleBps(l.ratePaise, bps),
    capturedTaxableValuePaise: scaleBps(l.capturedTaxableValuePaise, bps),
    capturedTaxAmountPaise: scaleBps(l.capturedTaxAmountPaise, bps),
  };
}

function toInvoiceLine(
  l: typeof estimateLines.$inferSelect,
): Omit<typeof invoiceLines.$inferInsert, 'invoiceId' | 'createdBy' | 'updatedBy'> {
  return {
    lineNo: l.lineNo,
    serviceItemId: l.serviceItemId,
    description: l.description,
    sacCode: l.sacCode,
    qty: l.qty,
    ratePaise: l.ratePaise,
    capturedTaxableValuePaise: l.capturedTaxableValuePaise,
    capturedTaxRateBps: l.capturedTaxRateBps,
    capturedTaxAmountPaise: l.capturedTaxAmountPaise,
    postingAccountCode: l.postingAccountCode,
  };
}

function scaleBps(amount: bigint, bps: bigint): bigint {
  // amount * bps / 10000, integer paise. Banker's-rounding not needed — the
  // captured values are user-confirmed before sending.
  return (amount * bps) / 10000n;
}

async function isEstimateFullyConverted(estimateId: string, client: DbClient): Promise<boolean> {
  const [estimateRow] = await client
    .select({ capturedTotalPaise: estimates.capturedTotalPaise })
    .from(estimates)
    .where(eq(estimates.id, estimateId))
    .limit(1);
  if (!estimateRow) return false;
  const [agg] = await client
    .select({ total: sum(estimateInvoiceLinks.valuePaise) })
    .from(estimateInvoiceLinks)
    .where(eq(estimateInvoiceLinks.estimateId, estimateId));
  const totalConverted = agg?.total != null ? BigInt(agg.total as string) : 0n;
  return totalConverted >= estimateRow.capturedTotalPaise;
}

// Silence the unused-import lint until we either consume `and` somewhere
// (likely Phase 7 when AR aging joins on (estimate, invoice)) or remove
// it. Keep the import so the symbol-search trail stays intact.
void and;
