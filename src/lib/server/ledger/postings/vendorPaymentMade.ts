import 'server-only';

import { z } from 'zod';

import type { PostingDraft, PostingTemplateResult } from '../types';

/**
 * LEDGER-SPEC §3.5 — vendor_payment_made.
 *
 * Money paid to a vendor. The payable is cleared by net cash + (optional) TDS
 * we withhold and owe the government:
 *
 *   Dr  2110 Trade Payables (sub: vendor_id)              amount (gross settled)
 *      Cr  1120 Bank (sub: bank_id) | 1110 Cash | 1220 Advance   net paid (= amount − tds)
 *      Cr  2130 TDS Payable                                       tds withheld
 *
 * `amountPaise` is the GROSS settled against bills (= net cash paid + TDS).
 * GST + the vendor's bank account are captured on the cash-leg metadata (GST is
 * already posted on the bill — not re-posted). Back-compat: legacy callers pass
 * only vendorId/bankAccountId/amountPaise (mode 'bank', tds/gst 0) → Dr 2110 / Cr 1120.
 */
export const VendorPaymentMadeInputSchema = z.object({
  vendorId: z.string().uuid(),
  /** 'bank' → 1120 (needs bankAccountId); 'cash' → 1110. */
  mode: z.enum(['bank', 'cash']).default('bank'),
  bankAccountId: z.string().uuid().nullish(),
  /** The vendor's bank account the money went to (entity_bank_accounts.id) — noted. */
  counterpartyBankAccountId: z.string().uuid().nullish(),
  amountPaise: z.bigint(),
  /** Pay from a vendor advance (1220) instead of bank/cash. */
  source: z.enum(['bank', 'advance']).default('bank'),
  /** TDS we withheld from this payment → our liability to the govt (2130). */
  tdsPaise: z.bigint().nonnegative().default(0n),
  tdsSection: z.string().nullish(),
  /** GST noted on the payment (already posted on the bill — captured, not re-posted). */
  gstPaise: z.bigint().nonnegative().default(0n),
  billAllocations: z
    .array(z.object({ billTxnId: z.string().uuid(), amountPaise: z.bigint() }))
    .default([]),
  paymentDocumentId: z.string().uuid().optional(),
  externalRef: z.string().min(1),
  txnDate: z.string(),
  notes: z.string().nullish(),
});

// z.input: callers may omit .default() fields; the template fills them via .parse().
export type VendorPaymentMadeInput = z.input<typeof VendorPaymentMadeInputSchema>;

export function vendorPaymentMade(input: VendorPaymentMadeInput): PostingTemplateResult {
  const parsed = VendorPaymentMadeInputSchema.parse(input);
  const cashAccount =
    parsed.source === 'advance' ? '1220' : parsed.mode === 'cash' ? '1110' : '1120';
  const cashAmount = parsed.amountPaise - parsed.tdsPaise; // net actually paid out

  const postings: PostingDraft[] = [
    {
      accountCode: '2110',
      side: 'debit',
      amountPaise: parsed.amountPaise,
      subledger: { entityType: 'vendor', entityId: parsed.vendorId },
    },
  ];

  if (cashAmount > 0n) {
    postings.push({
      accountCode: cashAccount,
      side: 'credit',
      amountPaise: cashAmount,
      // 1220 advance + 1120 bank are control accounts (sub-ledgered); 1110 cash
      // is non-control (no subledger).
      ...(parsed.source === 'advance'
        ? { subledger: { entityType: 'vendor' as const, entityId: parsed.vendorId } }
        : parsed.mode === 'bank' && parsed.bankAccountId
          ? { subledger: { entityType: 'office' as const, entityId: parsed.bankAccountId } }
          : {}),
      metadata: {
        mode: parsed.mode,
        source: parsed.source,
        counterparty_bank_account_id: parsed.counterpartyBankAccountId ?? null,
        gst_paise: parsed.gstPaise.toString(),
      },
    });
  }

  if (parsed.tdsPaise > 0n) {
    postings.push({
      accountCode: '2130',
      side: 'credit',
      amountPaise: parsed.tdsPaise,
      metadata: { tds_section: parsed.tdsSection ?? null },
    });
  }

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
    postings,
  };
}
