import 'server-only';

import { z } from 'zod';

import type { PostingTemplateResult } from '../types';

/**
 * LEDGER-SPEC §3.5 — vendor_payment_made.
 *
 *   Dr  2110 Trade Payables (sub: vendor_id)        amount
 *      Cr  1120 Bank Accounts (sub: bank_id)              amount
 *
 * If paying from an advance: Dr 2110 / Cr 1220 (sub: vendor_id) instead.
 */
export const VendorPaymentMadeInputSchema = z.object({
  vendorId: z.string().uuid(),
  bankAccountId: z.string().uuid(),
  amountPaise: z.bigint(),
  source: z.enum(['bank', 'advance']).default('bank'),
  billAllocations: z
    .array(z.object({ billTxnId: z.string().uuid(), amountPaise: z.bigint() }))
    .default([]),
  paymentDocumentId: z.string().uuid().optional(),
  externalRef: z.string().min(1),
  txnDate: z.string(),
  notes: z.string().nullish(),
});

export type VendorPaymentMadeInput = z.infer<typeof VendorPaymentMadeInputSchema>;

export function vendorPaymentMade(input: VendorPaymentMadeInput): PostingTemplateResult {
  const parsed = VendorPaymentMadeInputSchema.parse(input);
  const creditAccount = parsed.source === 'advance' ? '1220' : '1120';
  return {
    externalRef: parsed.externalRef,
    description: `Payment to vendor`,
    txnDate: parsed.txnDate,
    sourceKind: parsed.paymentDocumentId ? 'payment' : 'bank_import',
    sourceDocumentId: parsed.paymentDocumentId,
    relatedEntityKind: 'vendor',
    relatedEntityId: parsed.vendorId,
    paidToVendorId: parsed.vendorId,
    notes: parsed.notes,
    postings: [
      {
        accountCode: '2110',
        side: 'debit',
        amountPaise: parsed.amountPaise,
        subledger: { entityType: 'vendor', entityId: parsed.vendorId },
      },
      {
        accountCode: creditAccount,
        side: 'credit',
        amountPaise: parsed.amountPaise,
        subledger:
          parsed.source === 'advance'
            ? { entityType: 'vendor', entityId: parsed.vendorId }
            : { entityType: 'office', entityId: parsed.bankAccountId },
      },
    ],
  };
}
