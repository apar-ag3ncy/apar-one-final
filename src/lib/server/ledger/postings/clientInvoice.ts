import 'server-only';

import { z } from 'zod';

import { sumPaise, type Paise } from '@/lib/money';

import type { PostingTemplateResult } from '../types';

/**
 * LEDGER-SPEC §3.1 — client_invoice.
 *
 *   Dr  1200 Trade Receivables (sub: client_id)    gross_total
 *      Cr  4100 Service Revenue (sub: client_id)         net_total
 *      Cr  2120 GST Output Payable                       gst_total
 *
 * Captured-not-computed: caller supplies the gst total from the invoice
 * line items; we don't multiply rates here.
 */

export const ClientInvoiceInputSchema = z.object({
  clientId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  invoiceDocumentId: z.string().uuid(),
  invoiceNumber: z.string().min(1),
  txnDate: z.string(), // YYYY-MM-DD
  lineItems: z
    .array(
      z.object({
        description: z.string(),
        amountPaise: z.bigint(),
        gstRateBpsCaptured: z.number().int().optional(),
        gstAmountPaiseCaptured: z.bigint().default(0n),
      }),
    )
    .min(1),
  notes: z.string().nullish(),
});

export type ClientInvoiceInput = z.infer<typeof ClientInvoiceInputSchema>;

export function clientInvoice(input: ClientInvoiceInput): PostingTemplateResult {
  const parsed = ClientInvoiceInputSchema.parse(input);
  const netTotal: Paise = sumPaise(parsed.lineItems.map((l) => l.amountPaise));
  const gstTotal: Paise = sumPaise(parsed.lineItems.map((l) => l.gstAmountPaiseCaptured));
  const grossTotal: Paise = netTotal + gstTotal;

  return {
    externalRef: `client_invoice:${parsed.invoiceNumber}`,
    description: `Invoice ${parsed.invoiceNumber} to client`,
    txnDate: parsed.txnDate,
    sourceKind: 'invoice',
    sourceDocumentId: parsed.invoiceDocumentId,
    relatedEntityKind: 'client',
    relatedEntityId: parsed.clientId,
    onBehalfOfClientId: parsed.clientId, // self-attribution for AR tracking
    projectId: parsed.projectId,
    notes: parsed.notes,
    postings: [
      {
        accountCode: '1200',
        side: 'debit',
        amountPaise: grossTotal,
        subledger: { entityType: 'client', entityId: parsed.clientId },
      },
      {
        accountCode: '4100',
        side: 'credit',
        amountPaise: netTotal,
        subledger: { entityType: 'client', entityId: parsed.clientId },
        // Stash the original (description, amount, gst) tuples so the
        // edit-draft form can reconstruct rows verbatim — postings only
        // carry the aggregated totals, so without this metadata the line
        // items can't be recovered for re-edit. bigint amounts are
        // serialised as strings (Postgres jsonb can't round-trip JS
        // bigints natively); the read-side parses them back.
        metadata: {
          line_items: parsed.lineItems.map((l) => ({
            description: l.description,
            amount_paise: l.amountPaise.toString(),
            gst_amount_paise_captured: l.gstAmountPaiseCaptured.toString(),
          })),
        },
      },
      ...(gstTotal > 0n
        ? [
            {
              accountCode: '2120',
              side: 'credit' as const,
              amountPaise: gstTotal,
            },
          ]
        : []),
    ],
  };
}
