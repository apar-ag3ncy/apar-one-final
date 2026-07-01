import 'server-only';

import { z } from 'zod';

import type { PostingTemplateResult } from '../types';

/**
 * LEDGER-SPEC §3.5 — vendor_payment_made.
 *
 *   Dr  2110 Trade Payables (sub: vendor_id)        amount
 *      Cr  1120 Bank Accounts (sub: bank_id)              amount
 *
 * Credit leg by `source`:
 *   - 'bank'    → Cr 1120 Bank Accounts (sub: bank_id)
 *   - 'advance' → Cr 1220 Advances to Vendors (sub: vendor_id)
 *   - 'cash'    → Cr 1110 Cash on Hand (no sub-ledger)
 *
 * GST/TDS on a vendor payment are informational only (vendor TDS is already
 * withheld into 2130 at bill time; re-posting here would double-count), so
 * they + the vendor's own bank account are stashed on the 2110 debit leg's
 * metadata for traceability, not posted. jsonb can't hold bigint, so amounts
 * are serialised to strings.
 */
export const VendorPaymentMadeInputSchema = z
  .object({
    vendorId: z.string().uuid(),
    /** Our bank account the money left from. Null/omitted iff source ≠ 'bank'. */
    bankAccountId: z.string().uuid().nullish(),
    amountPaise: z.bigint(),
    source: z.enum(['bank', 'advance', 'cash']).default('bank'),
    /** Informational only — see note above. */
    gstAmountPaise: z.bigint().nonnegative().default(0n),
    tdsAmountPaise: z.bigint().nonnegative().default(0n),
    /** Which of the VENDOR's saved bank accounts received the money. */
    counterpartyBankAccountId: z.string().uuid().nullish(),
    billAllocations: z
      .array(z.object({ billTxnId: z.string().uuid(), amountPaise: z.bigint() }))
      .default([]),
    paymentDocumentId: z.string().uuid().optional(),
    externalRef: z.string().min(1),
    txnDate: z.string(),
    notes: z.string().nullish(),
  })
  .refine((v) => v.source !== 'bank' || !!v.bankAccountId, {
    message: "bankAccountId is required when source is 'bank'",
  });

export type VendorPaymentMadeInput = z.infer<typeof VendorPaymentMadeInputSchema>;

export function vendorPaymentMade(input: VendorPaymentMadeInput): PostingTemplateResult {
  const parsed = VendorPaymentMadeInputSchema.parse(input);
  const creditAccount =
    parsed.source === 'advance' ? '1220' : parsed.source === 'cash' ? '1110' : '1120';

  const creditSubledger =
    parsed.source === 'advance'
      ? { entityType: 'vendor' as const, entityId: parsed.vendorId }
      : parsed.source === 'cash'
        ? undefined // 1110 Cash on Hand is non-control — no sub-ledger
        : { entityType: 'office' as const, entityId: parsed.bankAccountId! };

  const debitMetadata: Record<string, unknown> = {};
  if (parsed.gstAmountPaise > 0n) debitMetadata.gstAmountPaise = parsed.gstAmountPaise.toString();
  if (parsed.tdsAmountPaise > 0n) debitMetadata.tdsAmountPaise = parsed.tdsAmountPaise.toString();
  if (parsed.counterpartyBankAccountId)
    debitMetadata.counterpartyBankAccountId = parsed.counterpartyBankAccountId;

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
        ...(Object.keys(debitMetadata).length > 0 ? { metadata: debitMetadata } : {}),
      },
      {
        accountCode: creditAccount,
        side: 'credit',
        amountPaise: parsed.amountPaise,
        ...(creditSubledger ? { subledger: creditSubledger } : {}),
      },
    ],
  };
}
