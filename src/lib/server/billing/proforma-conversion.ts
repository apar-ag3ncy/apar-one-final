'use server';

import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import { invoiceLines } from '@/lib/db/schema/invoice_lines';
import { invoices } from '@/lib/db/schema/invoices';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

import { createDraftInvoice } from './invoices';

/**
 * Proforma → tax-invoice conversion.
 *
 * Per the product decision, a proforma is converted by creating a SEPARATE tax
 * invoice (its own number in the invoice series) while the proforma is kept as
 * a record — mirroring estimate → invoice. The new invoice is a fresh DRAFT so
 * the operator can review / adjust the date before sending; nothing posts to
 * the ledger until it's sent, exactly like any other invoice.
 *
 * We reuse `createDraftInvoice` (so all validation, numbering and billing-
 * readiness checks apply) and derive the idempotency key from the proforma id.
 * That makes re-conversion return the SAME tax invoice instead of spawning a
 * duplicate, and lets the UI look up "has this proforma been converted?"
 * without a schema change (which would also collide with the sent-invoice
 * immutability trigger if we tried to flag the proforma row itself).
 */

const CONVERSION_KEY_PREFIX = 'proforma-conv:';

// The idempotency key of the tax invoice produced from a given proforma.
// NOT exported: a `'use server'` module may only export async server actions —
// a sync export passes local tsc but breaks the Vercel build.
function conversionKeyFor(proformaId: string): string {
  return `${CONVERSION_KEY_PREFIX}${proformaId}`;
}

export type ConvertProformaResult = {
  invoiceId: string;
  documentNumber: string;
  /** true when this proforma had already been converted (idempotent re-call). */
  alreadyConverted: boolean;
};

function parsePaise(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (typeof v === 'string' && v.trim() !== '') {
    try {
      return BigInt(v);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

/** Look up the tax invoice a proforma was converted into, if any. */
export async function getConvertedInvoiceFor(
  proformaId: string,
): Promise<{ invoiceId: string; documentNumber: string } | null> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'create_invoice');
  const id = z.string().uuid().parse(proformaId);
  // Primary lookup: the persisted linkage column (0062). Fall back to the
  // legacy idempotency-key convention for rows created before the backfill.
  const [row] = await db
    .select({ id: invoices.id, documentNumber: invoices.documentNumber })
    .from(invoices)
    .where(eq(invoices.convertedFromInvoiceId, id))
    .limit(1);
  if (row) return { invoiceId: row.id, documentNumber: row.documentNumber };
  const [legacy] = await db
    .select({ id: invoices.id, documentNumber: invoices.documentNumber })
    .from(invoices)
    .where(eq(invoices.idempotencyKey, conversionKeyFor(id)))
    .limit(1);
  return legacy ? { invoiceId: legacy.id, documentNumber: legacy.documentNumber } : null;
}

export async function convertProformaToInvoice(proformaId: string): Promise<ConvertProformaResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'create_invoice');
  const id = z.string().uuid().parse(proformaId);

  const [proforma] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!proforma) throw new AppError('not_found', 'Proforma not found.');
  if (proforma.documentType !== 'proforma') {
    throw new AppError('validation', 'Only a proforma can be converted to a tax invoice.');
  }

  const key = conversionKeyFor(id);

  // Already converted → return the existing tax invoice (idempotent).
  const [existing] = await db
    .select({ id: invoices.id, documentNumber: invoices.documentNumber })
    .from(invoices)
    .where(eq(invoices.idempotencyKey, key))
    .limit(1);
  if (existing) {
    return {
      invoiceId: existing.id,
      documentNumber: existing.documentNumber,
      alreadyConverted: true,
    };
  }

  const lines = await db
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, id))
    .orderBy(asc(invoiceLines.lineNo));
  if (lines.length === 0) {
    throw new AppError('validation', 'This proforma has no line items to convert.');
  }

  const split = (proforma.capturedTaxSplit ?? {}) as Record<string, unknown>;

  // Reuse the full invoice-creation path: fresh number auto-allocated, all
  // validations run, and the derived idempotency key guards double-conversion.
  const result = await createDraftInvoice({
    clientId: proforma.clientId,
    projectId: proforma.projectId,
    // Carry the retainer flag and record the conversion source (0062) —
    // previously both were dropped in the copy.
    coveredUnderRetainer: proforma.coveredUnderRetainer,
    convertedFromInvoiceId: proforma.id,
    documentType: 'invoice',
    billToAddressId: proforma.billToAddressId,
    documentDate: proforma.documentDate,
    dueDate: proforma.dueDate,
    subtotalPaise: parsePaise(proforma.subtotalPaise),
    capturedTaxTotalPaise: parsePaise(proforma.capturedTaxTotalPaise),
    capturedTotalPaise: parsePaise(proforma.capturedTotalPaise),
    placeOfSupply: proforma.placeOfSupply,
    capturedTaxSplit: {
      cgst_paise: parsePaise(split.cgst_paise),
      sgst_paise: parsePaise(split.sgst_paise),
      igst_paise: parsePaise(split.igst_paise),
      cess_paise: parsePaise(split.cess_paise),
    },
    terms: proforma.terms,
    notes: proforma.notes,
    themeId: proforma.themeId,
    bankAccountId: proforma.bankAccountId,
    idempotencyKey: key,
    lines: lines.map((l) => ({
      lineNo: l.lineNo,
      serviceItemId: l.serviceItemId,
      // Per-line project attribution survives the conversion (0062).
      projectId: l.projectId,
      description: l.description,
      sacCode: l.sacCode,
      qty: l.qty,
      ratePaise: parsePaise(l.ratePaise),
      capturedTaxableValuePaise: parsePaise(l.capturedTaxableValuePaise),
      capturedTaxRateBps: l.capturedTaxRateBps,
      capturedTaxAmountPaise: parsePaise(l.capturedTaxAmountPaise),
      postingAccountCode: l.postingAccountCode,
    })),
  });

  await logAudit({
    actorId: ctx.userId,
    entityType: 'invoices',
    entityId: result.id,
    action: 'insert',
    changes: {
      convertedFromProforma: { id, documentNumber: proforma.documentNumber },
      documentNumber: result.documentNumber,
    },
  });

  return { invoiceId: result.id, documentNumber: result.documentNumber, alreadyConverted: false };
}
