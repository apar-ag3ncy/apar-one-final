import 'server-only';

import { z } from 'zod';

import { AppError } from '@/lib/errors';
import { sumPaise, type Paise } from '@/lib/money';
import { isValidTdsSection, type TdsSection } from '@/lib/validators';

import type { PostingTemplateResult } from '../types';

/**
 * LEDGER-SPEC §3.4 + §0.6 — vendor_bill. **THE CRITICAL ENFORCEMENT POINT.**
 *
 * The vendor bill MUST carry an explicit `attribution`:
 *
 *   - `'client'` → on_behalf_of_client_id REQUIRED, posts to 5100
 *     (Vendor Costs, sub: vendor) and tags `on_behalf_of_client_id`
 *     on the transaction. THIS is what drives per-client P&L.
 *   - `'opex'` → expenseAccountCode REQUIRED (one of 6xxx), no client tag
 *   - `'asset'` → posts to 1510, no client tag, capitalization
 *     threshold check is the caller's responsibility (`net > ₹5k`)
 *
 * Refuses to save without an attribution answer. This is the §0.6
 * "per-client profitability is sacred" guard, also seeded as
 * `client_attribution_missing` block-severity validation rule.
 */

const opExAccountCodes = ['6100', '6200', '6300', '6400', '6900', '8100'] as const;

export const VendorBillInputSchema = z.discriminatedUnion('attribution', [
  z.object({
    attribution: z.literal('client'),
    vendorId: z.string().uuid(),
    onBehalfOfClientId: z.string().uuid(),
    projectId: z.string().uuid().optional(),
    billDocumentId: z.string().uuid(),
    vendorInvoiceNumber: z.string().min(1),
    txnDate: z.string(),
    lineItems: z
      .array(
        z.object({
          description: z.string(),
          amountPaise: z.bigint(),
          gstAmountPaiseCaptured: z.bigint().default(0n),
        }),
      )
      .min(1),
    tdsAmountPaise: z.bigint().default(0n),
    tdsSection: z
      .string()
      .refine((v) => v === '' || isValidTdsSection(v), { message: 'invalid TDS section' })
      .optional(),
    isRcm: z.boolean().default(false),
    notes: z.string().nullish(),
  }),
  z.object({
    attribution: z.literal('opex'),
    vendorId: z.string().uuid(),
    expenseAccountCode: z.enum(opExAccountCodes),
    billDocumentId: z.string().uuid(),
    vendorInvoiceNumber: z.string().min(1),
    txnDate: z.string(),
    lineItems: z
      .array(
        z.object({
          description: z.string(),
          amountPaise: z.bigint(),
          gstAmountPaiseCaptured: z.bigint().default(0n),
        }),
      )
      .min(1),
    tdsAmountPaise: z.bigint().default(0n),
    tdsSection: z
      .string()
      .refine((v) => v === '' || isValidTdsSection(v), { message: 'invalid TDS section' })
      .optional(),
    isRcm: z.boolean().default(false),
    notes: z.string().nullish(),
  }),
  z.object({
    attribution: z.literal('asset'),
    vendorId: z.string().uuid(),
    billDocumentId: z.string().uuid(),
    vendorInvoiceNumber: z.string().min(1),
    txnDate: z.string(),
    lineItems: z
      .array(
        z.object({
          description: z.string(),
          amountPaise: z.bigint(),
          gstAmountPaiseCaptured: z.bigint().default(0n),
        }),
      )
      .min(1),
    isRcm: z.boolean().default(false),
    notes: z.string().nullish(),
  }),
]);

export type VendorBillInput = z.infer<typeof VendorBillInputSchema>;

export function vendorBill(input: VendorBillInput): PostingTemplateResult {
  // Defensive — even if Zod parsed without attribution somehow, refuse.
  if (!('attribution' in input)) {
    throw new AppError(
      'ledger.attribution_missing',
      'vendor_bill requires explicit attribution: client | opex | asset.',
    );
  }
  const parsed = VendorBillInputSchema.parse(input);

  const netTotal: Paise = sumPaise(parsed.lineItems.map((l) => l.amountPaise));
  const gstTotal: Paise = sumPaise(parsed.lineItems.map((l) => l.gstAmountPaiseCaptured));
  const gross: Paise = netTotal + gstTotal;
  const tds: Paise = parsed.attribution === 'asset' ? 0n : (parsed.tdsAmountPaise ?? 0n);
  const payableToVendor: Paise = gross - tds;

  const externalRef = `vendor_bill:${parsed.vendorId}:${parsed.vendorInvoiceNumber}`;
  const description = `Vendor bill ${parsed.vendorInvoiceNumber} (${parsed.attribution})`;

  // Stash the per-line breakdown on the net-debit posting's metadata, exactly
  // as clientInvoice() does. Postings only carry aggregated totals (net on the
  // expense/asset account, GST on 1250), so without this stash an edit could
  // not reconstruct the original lines. `getDraftVendorBill` reads it back.
  const lineItemsMeta = parsed.lineItems.map((l) => ({
    description: l.description,
    amount_paise: l.amountPaise.toString(),
    gst_amount_paise_captured: (l.gstAmountPaiseCaptured ?? 0n).toString(),
  }));

  const base = {
    externalRef,
    description,
    txnDate: parsed.txnDate,
    sourceKind: 'bill' as const,
    sourceDocumentId: parsed.billDocumentId,
    relatedEntityKind: 'vendor' as const,
    relatedEntityId: parsed.vendorId,
    paidToVendorId: parsed.vendorId,
    notes: parsed.notes,
  };

  const tdsMeta =
    tds > 0n
      ? {
          tds_section: (parsed as { tdsSection?: string }).tdsSection as TdsSection | undefined,
          is_rcm: parsed.isRcm,
        }
      : { is_rcm: parsed.isRcm };

  if (parsed.attribution === 'client') {
    return {
      ...base,
      onBehalfOfClientId: parsed.onBehalfOfClientId,
      projectId: parsed.projectId,
      postings: [
        {
          accountCode: '5100',
          side: 'debit',
          amountPaise: netTotal,
          subledger: { entityType: 'vendor', entityId: parsed.vendorId },
          metadata: { attribution: 'client', is_rcm: parsed.isRcm, line_items: lineItemsMeta },
        },
        ...(gstTotal > 0n
          ? [
              {
                accountCode: '1250',
                side: 'debit' as const,
                amountPaise: gstTotal,
                metadata: { is_rcm: parsed.isRcm },
              },
            ]
          : []),
        {
          accountCode: '2110',
          side: 'credit',
          amountPaise: payableToVendor,
          subledger: { entityType: 'vendor', entityId: parsed.vendorId },
        },
        ...(tds > 0n
          ? [
              {
                accountCode: '2130',
                side: 'credit' as const,
                amountPaise: tds,
                metadata: tdsMeta,
              },
            ]
          : []),
      ],
    };
  }

  if (parsed.attribution === 'opex') {
    return {
      ...base,
      postings: [
        {
          accountCode: parsed.expenseAccountCode,
          side: 'debit',
          amountPaise: netTotal,
          metadata: { attribution: 'opex', is_rcm: parsed.isRcm, line_items: lineItemsMeta },
        },
        ...(gstTotal > 0n
          ? [
              {
                accountCode: '1250',
                side: 'debit' as const,
                amountPaise: gstTotal,
                metadata: { is_rcm: parsed.isRcm },
              },
            ]
          : []),
        {
          accountCode: '2110',
          side: 'credit',
          amountPaise: payableToVendor,
          subledger: { entityType: 'vendor', entityId: parsed.vendorId },
        },
        ...(tds > 0n
          ? [
              {
                accountCode: '2130',
                side: 'credit' as const,
                amountPaise: tds,
                metadata: tdsMeta,
              },
            ]
          : []),
      ],
    };
  }

  // attribution === 'asset'
  return {
    ...base,
    postings: [
      {
        accountCode: '1510',
        side: 'debit',
        amountPaise: netTotal,
        metadata: { attribution: 'asset', is_rcm: parsed.isRcm, line_items: lineItemsMeta },
      },
      ...(gstTotal > 0n
        ? [
            {
              accountCode: '1250',
              side: 'debit' as const,
              amountPaise: gstTotal,
              metadata: { is_rcm: parsed.isRcm },
            },
          ]
        : []),
      {
        accountCode: '2110',
        side: 'credit',
        amountPaise: gross,
        subledger: { entityType: 'vendor', entityId: parsed.vendorId },
      },
    ],
  };
}
