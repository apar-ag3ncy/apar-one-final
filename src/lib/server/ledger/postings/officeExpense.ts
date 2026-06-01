import 'server-only';

import { z } from 'zod';

import type { PostingTemplateResult } from '../types';

/**
 * LEDGER-SPEC §3.8 — office_expense (OpEx paid directly, skipping payable).
 *
 *   Dr  <6xxx>                                net
 *   Dr  1250 GST Input Credit                 gst
 *      Cr  1120 Bank Accounts (sub: bank)            (gross - tds)
 *      Cr  2130 TDS Payable                          tds (if applicable)
 */
const opExCodes = ['6100', '6200', '6300', '6400', '6900', '8100'] as const;

export const OfficeExpenseInputSchema = z.object({
  bankAccountId: z.string().uuid(),
  accountCode: z.enum(opExCodes),
  vendorId: z.string().uuid().optional(),
  netAmountPaise: z.bigint(),
  gstAmountPaiseCaptured: z.bigint().default(0n),
  tdsAmountPaise: z.bigint().default(0n),
  tdsSection: z.string().optional(),
  documentId: z.string().uuid(),
  externalRef: z.string().min(1),
  txnDate: z.string(),
  notes: z.string().nullish(),
});

export type OfficeExpenseInput = z.infer<typeof OfficeExpenseInputSchema>;

export function officeExpense(input: OfficeExpenseInput): PostingTemplateResult {
  const parsed = OfficeExpenseInputSchema.parse(input);
  const gross = parsed.netAmountPaise + parsed.gstAmountPaiseCaptured;
  const tds = parsed.tdsAmountPaise ?? 0n;
  const bankCredit = gross - tds;
  return {
    externalRef: parsed.externalRef,
    description: `Office expense (${parsed.accountCode})`,
    txnDate: parsed.txnDate,
    sourceKind: 'bill',
    sourceDocumentId: parsed.documentId,
    relatedEntityKind: 'office',
    paidToVendorId: parsed.vendorId,
    notes: parsed.notes,
    postings: [
      { accountCode: parsed.accountCode, side: 'debit', amountPaise: parsed.netAmountPaise },
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
        amountPaise: bankCredit,
        subledger: { entityType: 'office', entityId: parsed.bankAccountId },
      },
      ...(tds > 0n
        ? [
            {
              accountCode: '2130',
              side: 'credit' as const,
              amountPaise: tds,
              metadata: { tds_section: parsed.tdsSection },
            },
          ]
        : []),
    ],
  };
}
