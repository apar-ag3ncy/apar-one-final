import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { db, type DbClient } from '@/lib/db/client';
import {
  clients,
  entityAddresses,
  entityTaxIdentifiers,
  invoiceLines,
  invoices,
  organizations,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';

import type { InvoicePdfData } from './invoice';

/**
 * Assemble the InvoicePdfData snapshot from the DB. Pure read.
 *
 * Pulls:
 *   - the invoice header + lines (`invoices`, `invoice_lines`)
 *   - the supplier (Apār) from the singleton `organizations` row
 *   - the recipient client from `clients` + their primary
 *     `entity_addresses` row + GSTIN from `entity_tax_identifiers`
 *
 * Captured-not-computed: every monetary field comes verbatim from the
 * invoice rows; the renderer never re-derives.
 */
export async function loadInvoicePdfData(
  invoiceId: string,
  client: DbClient = db,
): Promise<InvoicePdfData> {
  const [invoice] = await client.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!invoice) throw new AppError('not_found', `invoice ${invoiceId} not found`);

  const lines = await client
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId))
    .orderBy(asc(invoiceLines.lineNo));

  const [supplierOrg] = await client.select().from(organizations).limit(1);
  if (!supplierOrg) {
    throw new AppError(
      'internal',
      "organizations table empty; seed Apār's organization row before rendering invoices.",
    );
  }

  const [recipient] = await client
    .select()
    .from(clients)
    .where(eq(clients.id, invoice.clientId))
    .limit(1);
  if (!recipient) {
    throw new AppError('not_found', `client ${invoice.clientId} not found`);
  }

  // Recipient address — first registered address; fallback to any address.
  const recipientAddresses = await client
    .select()
    .from(entityAddresses)
    .where(
      and(eq(entityAddresses.entityType, 'client'), eq(entityAddresses.entityId, invoice.clientId)),
    )
    .orderBy(asc(entityAddresses.kind));
  const recipientAddress =
    recipientAddresses.find((a) => a.kind === 'registered') ?? recipientAddresses[0] ?? null;

  // Recipient GSTIN — first entity_tax_identifiers row with kind='gstin'.
  const recipientTaxIds = await client
    .select()
    .from(entityTaxIdentifiers)
    .where(
      and(
        eq(entityTaxIdentifiers.entityType, 'client'),
        eq(entityTaxIdentifiers.entityId, invoice.clientId),
        eq(entityTaxIdentifiers.kind, 'gstin'),
      ),
    )
    .limit(1);
  const recipientGstin = recipientTaxIds[0]?.maskedValue ?? null;

  // Captured tax split is stored as JSONB with string-encoded bigints
  // (see invoices.ts:serialiseTaxSplit). Re-hydrate to bigint.
  const split = (invoice.capturedTaxSplit ?? {}) as Record<string, string | number | undefined>;
  const splitBigint = {
    cgstPaise: toBigint(split.cgst_paise),
    sgstPaise: toBigint(split.sgst_paise),
    igstPaise: toBigint(split.igst_paise),
    cessPaise: toBigint(split.cess_paise),
  };

  const supplierStateCode =
    supplierOrg.gstin && supplierOrg.gstin.length >= 2 ? supplierOrg.gstin.slice(0, 2) : '27';

  const recipientStateCode =
    (recipientAddress?.stateCode && recipientAddress.stateCode.length === 2
      ? recipientAddress.stateCode
      : null) ?? (recipientGstin && recipientGstin.length >= 2 ? recipientGstin.slice(0, 2) : null);

  return {
    supplier: {
      name: supplierOrg.displayName ?? supplierOrg.legalName,
      address: supplierOrg.registeredAddress ?? '',
      gstin: supplierOrg.gstin ?? null,
      pan: supplierOrg.pan ?? null,
      stateCode: supplierStateCode,
      contactEmail: null, // organizations doesn't carry contact email today
      contactPhone: null,
      logoBucket: null,
      logoStoragePath: null,
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
      stateCode: recipientStateCode,
      contactEmail: null, // resolve via entity_contacts later
    },
    documentNumber: invoice.documentNumber,
    documentDate: invoice.documentDate,
    dueDate: invoice.dueDate,
    placeOfSupply: invoice.placeOfSupply,
    isReverseCharge: false, // sales side: reverse charge is rare; flip on later if needed
    lines: lines.map((l) => ({
      lineNo: l.lineNo,
      description: l.description,
      sacCode: l.sacCode,
      unit: null, // line-level unit not on invoice_lines today
      qty: l.qty,
      ratePaise: l.ratePaise,
      capturedTaxableValuePaise: l.capturedTaxableValuePaise,
      capturedTaxRateBps: l.capturedTaxRateBps,
      capturedTaxAmountPaise: l.capturedTaxAmountPaise,
    })),
    subtotalPaise: invoice.subtotalPaise,
    capturedTaxSplit: splitBigint,
    capturedTaxTotalPaise: invoice.capturedTaxTotalPaise,
    capturedTotalPaise: invoice.capturedTotalPaise,
    paymentLink: invoice.razorpayPaymentLinkUrl
      ? { url: invoice.razorpayPaymentLinkUrl, qrPngBytes: null }
      : null,
    terms: invoice.terms,
    notes: invoice.notes,
  };
}

function toBigint(v: unknown): bigint {
  if (v == null) return 0n;
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return BigInt(v);
  return 0n;
}
