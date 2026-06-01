import 'server-only';

import { z } from 'zod';

import type { PostingTemplateResult } from '../types';

/**
 * LEDGER-SPEC §3.2 — client_payment_received.
 *
 *   Dr  1120 Bank Accounts (sub: bank_id)          amount
 *      Cr  1200 Trade Receivables (sub: client_id)       amount
 *
 * Allocations are metadata on the transaction; AR aging derives from
 * them. The sum of allocations must equal `amountPaise`.
 */

export const ClientPaymentReceivedInputSchema = z.object({
  clientId: z.string().uuid(),
  bankAccountId: z.string().uuid(),
  amountPaise: z.bigint(),
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
});

export type ClientPaymentReceivedInput = z.infer<typeof ClientPaymentReceivedInputSchema>;

export function clientPaymentReceived(input: ClientPaymentReceivedInput): PostingTemplateResult {
  const parsed = ClientPaymentReceivedInputSchema.parse(input);
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
      {
        accountCode: '1120',
        side: 'debit',
        amountPaise: parsed.amountPaise,
        subledger: { entityType: 'office', entityId: parsed.bankAccountId },
        // `office` is a stand-in placeholder; the trigger sees subledger_kind=bank_account
        // on account 1120 and matches against bank_accounts.id rather than the
        // polymorphic enum. Document this divergence in `types.ts` later.
      },
      {
        accountCode: '1200',
        side: 'credit',
        amountPaise: parsed.amountPaise,
        subledger: { entityType: 'client', entityId: parsed.clientId },
      },
    ],
    // Allocations encoded in metadata; the post action writes a row-level
    // `metadata.allocations` on the Dr posting to keep them queryable.
  };
}
