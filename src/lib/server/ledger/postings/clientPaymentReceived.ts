import 'server-only';

import { z } from 'zod';

import type { PostingDraft, PostingTemplateResult } from '../types';

/**
 * LEDGER-SPEC §3.2 — client_payment_received.
 *
 * Money received from a client. Cash leg + (optional) TDS-receivable leg
 * settle the receivable:
 *
 *   Dr  1120 Bank (sub: bank_id)   |  1110 Cash       net received (= amount − tds)
 *   Dr  1260 TDS Receivable                            tds withheld by the client
 *      Cr  1200 Trade Receivables (sub: client_id)        amount (gross settled)
 *
 * `amountPaise` is the GROSS amount settled against invoices (= net cash + TDS).
 * The receivable cleared equals `amountPaise`; receipt_allocations apply it to
 * `client_invoice` transactions. GST + the client's bank account are captured
 * on the cash-leg metadata (GST is already posted on the invoice — not
 * re-posted here). Back-compat: legacy callers pass only clientId/bankAccountId/
 * amountPaise (mode defaults 'bank', tds/gst default 0) → Dr 1120 / Cr 1200.
 */

export const ClientPaymentReceivedInputSchema = z.object({
  clientId: z.string().uuid(),
  /** 'bank' → 1120 (needs bankAccountId); 'cash' → 1110. */
  mode: z.enum(['bank', 'cash']).default('bank'),
  bankAccountId: z.string().uuid().nullish(),
  /** The client's bank account the money came from (entity_bank_accounts.id) — noted. */
  counterpartyBankAccountId: z.string().uuid().nullish(),
  amountPaise: z.bigint(),
  /** TDS withheld by the client from this receipt → our receivable (1260). */
  tdsPaise: z.bigint().nonnegative().default(0n),
  tdsSection: z.string().nullish(),
  /** GST noted on the receipt (already posted on the invoice — captured, not re-posted). */
  gstPaise: z.bigint().nonnegative().default(0n),
  /** Ignored — allocations are written to receipt_allocations by the action. Kept for back-compat. */
  invoiceAllocations: z
    .array(z.object({ invoiceTxnId: z.string().uuid(), amountPaise: z.bigint() }))
    .default([]),
  receiptDocumentId: z.string().uuid().optional(),
  externalRef: z.string().min(1),
  txnDate: z.string(),
  notes: z.string().nullish(),
});

// z.input (not z.infer): callers may omit fields that have a .default() — the
// template fills them via .parse(). The orchestrator union references this type.
export type ClientPaymentReceivedInput = z.input<typeof ClientPaymentReceivedInputSchema>;

export function clientPaymentReceived(input: ClientPaymentReceivedInput): PostingTemplateResult {
  const parsed = ClientPaymentReceivedInputSchema.parse(input);

  const cashAccount = parsed.mode === 'cash' ? '1110' : '1120';
  const cashAmount = parsed.amountPaise - parsed.tdsPaise; // net actually received

  const postings: PostingDraft[] = [];

  if (cashAmount > 0n) {
    postings.push({
      accountCode: cashAccount,
      side: 'debit',
      amountPaise: cashAmount,
      // 1120 is a control account sub-ledgered by bank_accounts.id (entityType
      // 'office' is the placeholder the trigger expects). 1110 Cash is
      // non-control — no subledger.
      ...(parsed.mode === 'bank' && parsed.bankAccountId
        ? { subledger: { entityType: 'office' as const, entityId: parsed.bankAccountId } }
        : {}),
      metadata: {
        mode: parsed.mode,
        counterparty_bank_account_id: parsed.counterpartyBankAccountId ?? null,
        gst_paise: parsed.gstPaise.toString(),
      },
    });
  }

  if (parsed.tdsPaise > 0n) {
    postings.push({
      accountCode: '1260',
      side: 'debit',
      amountPaise: parsed.tdsPaise,
      metadata: { tds_section: parsed.tdsSection ?? null },
    });
  }

  postings.push({
    accountCode: '1200',
    side: 'credit',
    amountPaise: parsed.amountPaise,
    subledger: { entityType: 'client', entityId: parsed.clientId },
  });

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
    postings,
  };
}
