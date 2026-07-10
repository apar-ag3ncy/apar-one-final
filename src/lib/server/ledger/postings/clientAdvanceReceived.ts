import 'server-only';

import { z } from 'zod';

import type { PostingDraft, PostingTemplateResult } from '../types';

/**
 * LEDGER-SPEC §3.3 — client_advance_received.
 *
 * Per the agent-backend prompt §10.1 decision: advances go to a **separate**
 * `2180 Client Advances Received` liability account (sub: client), NOT a
 * negative balance on `1200`. (Spec author preferred the negative-1200
 * variant; the prompt overrode.)
 *
 *   Dr  1120 Bank (sub: bank_id)  |  1110 Cash          amount
 *      Cr  2180 Client Advances Received (sub: client)        amount
 *
 * The cash leg mirrors `client_payment_received`: `mode` picks the account
 * (`bank` → 1120 with the bank_accounts sub-ledger, `cash` → 1110, no
 * sub-ledger), and the transfer method / cheque details ride on the leg
 * metadata (captured for the books, no posting impact).
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
  /** 'bank' → 1120 (needs bankAccountId); 'cash' → 1110. Back-compat default 'bank'. */
  mode: z.enum(['bank', 'cash']).default('bank'),
  /** How the money arrived — captured on the cash-leg metadata, no posting impact. */
  transferMethod: z.enum(['neft', 'rtgs', 'imps', 'upi', 'cheque']).nullish(),
  /** Cheque capture (0064) — set when transferMethod='cheque'. */
  chequeNumber: z.string().nullish(),
  chequeDate: z.string().nullish(),
  /** Our agency bank account (bank_accounts.id) — required when mode='bank'. */
  bankAccountId: z.string().uuid().nullish(),
  amountPaise: z.bigint(),
  /** Optional advance-stage GST (Rule 50). Defaults to 0n. */
  advanceTaxPaise: z.bigint().nonnegative().default(0n),
  receiptDocumentId: z.string().uuid().optional(),
  externalRef: z.string().min(1),
  txnDate: z.string(),
  notes: z.string().nullish(),
});

// z.input (not z.infer): callers may omit fields that have a .default() — the
// template fills them via .parse(). The orchestrator union references this type.
export type ClientAdvanceReceivedInput = z.input<typeof ClientAdvanceReceivedInputSchema>;

export function clientAdvanceReceived(input: ClientAdvanceReceivedInput): PostingTemplateResult {
  const parsed = ClientAdvanceReceivedInputSchema.parse(input);
  const hasTax = parsed.advanceTaxPaise > 0n;

  // 'bank' → 1120 (control account, sub-ledgered by bank_accounts.id via the
  // 'office' placeholder the trigger expects); 'cash' → 1110 (non-control, no
  // subledger). Mirrors clientPaymentReceived.
  const cashAccount = parsed.mode === 'cash' ? '1110' : '1120';

  const postings: PostingDraft[] = [
    {
      accountCode: cashAccount,
      side: 'debit',
      amountPaise: parsed.amountPaise,
      ...(parsed.mode === 'bank' && parsed.bankAccountId
        ? { subledger: { entityType: 'office' as const, entityId: parsed.bankAccountId } }
        : {}),
      metadata: {
        mode: parsed.mode,
        transfer_method: parsed.mode === 'bank' ? (parsed.transferMethod ?? null) : null,
        cheque_number: parsed.chequeNumber ?? null,
        cheque_date: parsed.chequeDate ?? null,
      },
    },
    {
      accountCode: '2180',
      side: 'credit',
      amountPaise: parsed.amountPaise,
      subledger: { entityType: 'client', entityId: parsed.clientId },
    },
  ];

  if (hasTax) {
    postings.push({ accountCode: '1252', side: 'debit', amountPaise: parsed.advanceTaxPaise });
    postings.push({ accountCode: '2120', side: 'credit', amountPaise: parsed.advanceTaxPaise });
  }

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
    postings,
  };
}
