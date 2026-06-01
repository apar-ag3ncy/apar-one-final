import 'server-only';

import { z } from 'zod';

import type { PostingTemplateResult } from '../types';

/**
 * LEDGER-SPEC §3.6 — expense_on_behalf.
 *
 *   Dr  1240 Reimbursable Exp on Behalf (sub: client)   net
 *   Dr  1250 GST Input Credit                           gst
 *      Cr  1120 Bank Accounts (sub: bank)                     gross
 *
 * Pure pass-through: pay vendor straight from bank, book receivable against
 * client. Later, a `client_invoice`-flavored txn bills it back.
 */
export const ExpenseOnBehalfInputSchema = z.object({
  clientId: z.string().uuid(),
  vendorId: z.string().uuid(),
  bankAccountId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  netAmountPaise: z.bigint(),
  gstAmountPaiseCaptured: z.bigint().default(0n),
  billDocumentId: z.string().uuid(),
  externalRef: z.string().min(1),
  txnDate: z.string(),
  notes: z.string().nullish(),
});

export type ExpenseOnBehalfInput = z.infer<typeof ExpenseOnBehalfInputSchema>;

export function expenseOnBehalf(input: ExpenseOnBehalfInput): PostingTemplateResult {
  const parsed = ExpenseOnBehalfInputSchema.parse(input);
  const gross = parsed.netAmountPaise + parsed.gstAmountPaiseCaptured;
  return {
    externalRef: parsed.externalRef,
    description: `Expense on behalf of client (vendor paid directly)`,
    txnDate: parsed.txnDate,
    sourceKind: 'bill',
    sourceDocumentId: parsed.billDocumentId,
    relatedEntityKind: 'client',
    relatedEntityId: parsed.clientId,
    onBehalfOfClientId: parsed.clientId,
    paidToVendorId: parsed.vendorId,
    projectId: parsed.projectId,
    notes: parsed.notes,
    postings: [
      {
        accountCode: '1240',
        side: 'debit',
        amountPaise: parsed.netAmountPaise,
        subledger: { entityType: 'client', entityId: parsed.clientId },
      },
      ...(parsed.gstAmountPaiseCaptured > 0n
        ? [
            {
              accountCode: '1250',
              side: 'debit' as const,
              amountPaise: parsed.gstAmountPaiseCaptured,
            },
          ]
        : []),
      {
        accountCode: '1120',
        side: 'credit',
        amountPaise: gross,
        subledger: { entityType: 'office', entityId: parsed.bankAccountId },
      },
    ],
  };
}
