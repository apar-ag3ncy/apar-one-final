import 'server-only';

import { z } from 'zod';

import { AppError } from '@/lib/errors';
import { sumPaise } from '@/lib/money';

import type { PostingDraft, PostingTemplateResult } from '../types';

/**
 * LEDGER-SPEC §3.11 — journal (partner-only escape hatch).
 *
 * Free-form: any accounts, must balance, mandatory journal_reason.
 * No source document required. Used for opening balances, year-end
 * accruals, depreciation (when needed), and corrections without a
 * specific kind. Audit-logged prominently.
 */
export const JournalInputSchema = z.object({
  externalRef: z.string().min(1),
  txnDate: z.string(),
  journalReason: z.string().min(10),
  legs: z
    .array(
      z.object({
        accountCode: z.string(),
        side: z.enum(['debit', 'credit']),
        amountPaise: z.bigint(),
        subledger: z
          .object({
            entityType: z.enum(['client', 'vendor', 'employee', 'project', 'office']),
            entityId: z.string().uuid(),
          })
          .optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(2),
  isOpeningBalance: z.boolean().default(false),
  notes: z.string().nullish(),
});

export type JournalInput = z.infer<typeof JournalInputSchema>;

export function journal(input: JournalInput): PostingTemplateResult {
  const parsed = JournalInputSchema.parse(input);
  const debit = sumPaise(parsed.legs.filter((l) => l.side === 'debit').map((l) => l.amountPaise));
  const credit = sumPaise(parsed.legs.filter((l) => l.side === 'credit').map((l) => l.amountPaise));
  if (debit !== credit) {
    throw new AppError('ledger.unbalanced', `journal legs unbalanced: Dr=${debit}, Cr=${credit}`, {
      detail: { debit: debit.toString(), credit: credit.toString() },
    });
  }
  return {
    externalRef: parsed.externalRef,
    description: parsed.journalReason,
    txnDate: parsed.txnDate,
    sourceKind: parsed.isOpeningBalance ? 'opening_balance' : 'journal',
    notes: parsed.notes,
    postings: parsed.legs as PostingDraft[],
  };
}
