import 'server-only';

import { z } from 'zod';

import type { PostingTemplateResult } from '../types';

/**
 * LEDGER-SPEC §3.10 — partner_capital + partner_drawing.
 *
 * Capital:  Dr 1120 (sub: bank) / Cr 3100 (sub: partner_user_id)
 * Drawing:  Dr 3200 (sub: partner_user_id) / Cr 1120 (sub: bank)
 *
 * Per the prompt's §10.4 decision, partners are sub-ledgered by
 * partner_user_id.
 */
export const PartnerEquityInputSchema = z.object({
  partnerUserId: z.string().uuid(),
  kind: z.enum(['capital', 'drawing']),
  bankAccountId: z.string().uuid(),
  amountPaise: z.bigint(),
  externalRef: z.string().min(1),
  txnDate: z.string(),
  documentId: z.string().uuid().optional(),
  notes: z.string().nullish(),
});

export type PartnerEquityInput = z.infer<typeof PartnerEquityInputSchema>;

export function partnerEquity(input: PartnerEquityInput): PostingTemplateResult {
  const parsed = PartnerEquityInputSchema.parse(input);

  const bankPosting = {
    accountCode: '1120',
    amountPaise: parsed.amountPaise,
    subledger: { entityType: 'office' as const, entityId: parsed.bankAccountId },
  };
  // 3100 / 3200 use the partner_user_id subledger kind. The control trigger
  // enforces the matching kind; we represent the user via 'office' synthetic
  // type (no row in any principal table) since users.id isn't in entity_type.
  // The trigger's branch for partner_user_id checks `users WHERE id = X AND role = 'partner'`.
  const partnerPosting = {
    accountCode: parsed.kind === 'capital' ? '3100' : '3200',
    amountPaise: parsed.amountPaise,
    subledger: { entityType: 'office' as const, entityId: parsed.partnerUserId },
  };

  return {
    externalRef: parsed.externalRef,
    description: parsed.kind === 'capital' ? 'Partner capital introduced' : 'Partner drawing',
    txnDate: parsed.txnDate,
    sourceKind: parsed.documentId ? 'journal' : 'journal',
    sourceDocumentId: parsed.documentId,
    notes: parsed.notes,
    postings:
      parsed.kind === 'capital'
        ? [
            { ...bankPosting, side: 'debit' },
            { ...partnerPosting, side: 'credit' },
          ]
        : [
            { ...partnerPosting, side: 'debit' },
            { ...bankPosting, side: 'credit' },
          ],
  };
}
