import 'server-only';

import { z } from 'zod';

import type { PostingTemplateResult } from '../types';

/**
 * LEDGER-SPEC §3.2 — client_payment_received.
 *
 * `amountPaise` is the GROSS amount settled against the client's receivable.
 * When the client withholds TDS, the cash that actually lands is the gross
 * minus the TDS; the TDS becomes an asset we can later claim:
 *
 *   Dr  1120 Bank Accounts (sub: bank_id)     amount − tds   (cash received)
 *   Dr  1260 TDS Receivable                   tds            (if tds > 0)
 *      Cr  1200 Trade Receivables (sub: client_id)   amount  (gross settled)
 *
 * For a cash receipt (`cash: true`, no bank) the debit lands in 1110 Cash on
 * Hand instead of 1120. Balanced by construction: (amount − tds) + tds = amount.
 *
 * Allocations are tracked in payment_allocations; AR aging derives from them.
 * The sum of allocations must equal `amountPaise` (the gross).
 */

export const ClientPaymentReceivedInputSchema = z
  .object({
    clientId: z.string().uuid(),
    /** Our bank account the money landed in. Null/omitted iff `cash` is true. */
    bankAccountId: z.string().uuid().nullish(),
    /** True → cash receipt, debit 1110 Cash on Hand (no bank sub-ledger). */
    cash: z.boolean().default(false),
    /** GROSS settled against the receivable (cash received + TDS withheld). */
    amountPaise: z.bigint(),
    /** TDS the client withheld from us (0 when none). */
    tdsAmountPaise: z.bigint().nonnegative().default(0n),
    invoiceAllocations: z
      .array(
        z.object({
          invoiceTxnId: z.string().uuid(),
          amountPaise: z.bigint(),
        }),
      )
      .default([]),
    receiptDocumentId: z.string().uuid().optional(),
    externalRef: z.string().min(1),
    txnDate: z.string(),
    notes: z.string().nullish(),
  })
  .refine((v) => v.cash || !!v.bankAccountId, {
    message: 'bankAccountId is required unless cash is true',
  })
  .refine((v) => v.tdsAmountPaise <= v.amountPaise, {
    message: 'TDS cannot exceed the gross amount settled',
  });

export type ClientPaymentReceivedInput = z.infer<typeof ClientPaymentReceivedInputSchema>;

export function clientPaymentReceived(input: ClientPaymentReceivedInput): PostingTemplateResult {
  const parsed = ClientPaymentReceivedInputSchema.parse(input);
  const cashLandedPaise = parsed.amountPaise - parsed.tdsAmountPaise;

  const debits: PostingTemplateResult['postings'] = [];
  if (cashLandedPaise > 0n) {
    debits.push(
      parsed.cash
        ? { accountCode: '1110', side: 'debit', amountPaise: cashLandedPaise }
        : {
            accountCode: '1120',
            side: 'debit',
            amountPaise: cashLandedPaise,
            // `office` is a stand-in placeholder; the trigger sees
            // subledger_kind=bank_account on 1120 and matches against
            // bank_accounts.id rather than the polymorphic enum.
            subledger: { entityType: 'office', entityId: parsed.bankAccountId! },
          },
    );
  }
  if (parsed.tdsAmountPaise > 0n) {
    debits.push({
      accountCode: '1260',
      side: 'debit',
      amountPaise: parsed.tdsAmountPaise,
    });
  }

  return {
    externalRef: parsed.externalRef,
    description: `Payment received from client`,
    txnDate: parsed.txnDate,
    sourceKind: parsed.receiptDocumentId ? 'receipt' : 'bank_import',
    sourceDocumentId: parsed.receiptDocumentId,
    relatedEntityKind: 'client',
    relatedEntityId: parsed.clientId,
    onBehalfOfClientId: parsed.clientId,
    notes: parsed.notes,
    postings: [
      ...debits,
      {
        accountCode: '1200',
        side: 'credit',
        amountPaise: parsed.amountPaise,
        subledger: { entityType: 'client', entityId: parsed.clientId },
      },
    ],
  };
}
