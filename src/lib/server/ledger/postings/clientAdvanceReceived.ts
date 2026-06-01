import 'server-only';

import { z } from 'zod';

import type { PostingTemplateResult } from '../types';

/**
 * LEDGER-SPEC §3.3 — client_advance_received.
 *
 * Per the agent-backend prompt §10.1 decision: advances go to a **separate**
 * `2180 Client Advances Received` liability account (sub: client), NOT a
 * negative balance on `1200`. (Spec author preferred the negative-1200
 * variant; the prompt overrode.)
 *
 *   Dr  1120 Bank Accounts (sub: bank_id)               amount
 *      Cr  2180 Client Advances Received (sub: client)        amount
 *
 * **Rule 50 GST split (Phase 4.6 extension)** — when `advanceTaxPaise`
 * > 0, we additionally accrue the advance-stage output GST liability
 * and park its asset side in `1252 Advance-Output-GST-Asset`:
 *
 *   Dr  1252 Advance-Output-GST-Asset                   advanceTaxPaise
 *      Cr  2120 GST Output Payable                            advanceTaxPaise
 *
 * The unwind on later invoice issuance is handled by
 * `adjustAdvanceToInvoice` (Phase 4.7):
 *
 *   Dr  2180 Client Advances Received (sub: client)    invoiced_amount
 *      Cr  1200 Trade Receivables (sub: client)              invoiced_amount
 *   Dr  2120 GST Output Payable                         proportional_tax
 *      Cr  1252 Advance-Output-GST-Asset                     proportional_tax
 *
 * Captured-not-computed: `advanceTaxPaise` is the user-entered tax
 * amount (not derived from a rate × base). The validation rule
 * `advance_tax_default_rate` warns if it diverges from the reference
 * rate for the SAC.
 */

export const ClientAdvanceReceivedInputSchema = z.object({
  clientId: z.string().uuid(),
  bankAccountId: z.string().uuid(),
  amountPaise: z.bigint(),
  /** Optional advance-stage GST (Rule 50). Defaults to 0n. */
  advanceTaxPaise: z.bigint().nonnegative().default(0n),
  receiptDocumentId: z.string().uuid().optional(),
  externalRef: z.string().min(1),
  txnDate: z.string(),
  notes: z.string().nullish(),
});

export type ClientAdvanceReceivedInput = z.infer<typeof ClientAdvanceReceivedInputSchema>;

export function clientAdvanceReceived(input: ClientAdvanceReceivedInput): PostingTemplateResult {
  const parsed = ClientAdvanceReceivedInputSchema.parse(input);
  const hasTax = parsed.advanceTaxPaise > 0n;

  return {
    externalRef: parsed.externalRef,
    description: hasTax
      ? `Advance received from client with Rule 50 GST (Cr 2180 + Dr 1252 / Cr 2120)`
      : `Advance received from client (booked to 2180)`,
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
      },
      {
        accountCode: '2180',
        side: 'credit',
        amountPaise: parsed.amountPaise,
        subledger: { entityType: 'client', entityId: parsed.clientId },
      },
      ...(hasTax
        ? [
            {
              accountCode: '1252',
              side: 'debit' as const,
              amountPaise: parsed.advanceTaxPaise,
            },
            {
              accountCode: '2120',
              side: 'credit' as const,
              amountPaise: parsed.advanceTaxPaise,
            },
          ]
        : []),
    ],
  };
}
