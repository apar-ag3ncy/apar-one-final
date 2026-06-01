import 'server-only';

import { z } from 'zod';

import type { PostingTemplateResult } from '../types';

/**
 * LEDGER-SPEC §3.9 — inter_bank_transfer. No source document required;
 * source_kind='journal'. transfer_reference becomes the external_ref
 * suffix.
 */
export const InterBankTransferInputSchema = z
  .object({
    fromBankId: z.string().uuid(),
    toBankId: z.string().uuid(),
    amountPaise: z.bigint(),
    transferReference: z.string().min(1),
    txnDate: z.string(),
    notes: z.string().nullish(),
  })
  .refine((v) => v.fromBankId !== v.toBankId, {
    message: 'fromBankId and toBankId must differ',
  });

export type InterBankTransferInput = z.infer<typeof InterBankTransferInputSchema>;

export function interBankTransfer(input: InterBankTransferInput): PostingTemplateResult {
  const parsed = InterBankTransferInputSchema.parse(input);
  return {
    externalRef: `inter_bank_transfer:${parsed.transferReference}`,
    description: `Inter-bank transfer`,
    txnDate: parsed.txnDate,
    sourceKind: 'journal',
    notes: parsed.notes,
    postings: [
      {
        accountCode: '1120',
        side: 'debit',
        amountPaise: parsed.amountPaise,
        subledger: { entityType: 'office', entityId: parsed.toBankId },
      },
      {
        accountCode: '1120',
        side: 'credit',
        amountPaise: parsed.amountPaise,
        subledger: { entityType: 'office', entityId: parsed.fromBankId },
      },
    ],
  };
}
