import 'server-only';

import type { EntityType } from '@/lib/db/schema/_polymorphic';
import type { Paise } from '@/lib/money';

/**
 * Shared types for the ledger module. LEDGER-SPEC §1.2 + §3.
 */

export type PostingSide = 'debit' | 'credit';

/** One leg of a balanced journal entry, in code form. */
export type PostingDraft = {
  /** Account code from the 25-account chart (e.g. '5100'). */
  accountCode: string;
  side: PostingSide;
  /** Always positive. `side` distinguishes Dr/Cr. */
  amountPaise: Paise;
  /** Required iff account.is_control = true. */
  subledger?: {
    entityType: EntityType;
    entityId: string;
  };
  metadata?: Record<string, unknown>;
};

/** Output of every posting template. */
export type PostingTemplateResult = {
  externalRef: string;
  description: string;
  txnDate: string; // ISO date
  sourceKind:
    | 'invoice'
    | 'bill'
    | 'receipt'
    | 'payment'
    | 'payslip'
    | 'journal'
    | 'bank_import'
    | 'extraction'
    | 'opening_balance';
  sourceDocumentId?: string;
  relatedEntityKind?: EntityType;
  relatedEntityId?: string;
  onBehalfOfClientId?: string;
  paidToVendorId?: string;
  incurredByEmployeeId?: string;
  projectId?: string;
  postings: PostingDraft[];
  // `null` mirrors what entity-form payloads emit when the textarea is
  // empty (`notes.trim() || null`). The DB column is nullable text.
  notes?: string | null;
};

/** Validation flag attached to a draft transaction. */
export type ValidationFlag = {
  code: string;
  severity: 'info' | 'warn' | 'block';
  message: string;
  detail?: Record<string, unknown>;
};

export type LedgerError =
  | { kind: 'unbalanced'; debit: bigint; credit: bigint }
  | { kind: 'attribution_missing'; bill_kind: string }
  | { kind: 'source_document_missing'; transaction_kind: string }
  | { kind: 'external_ref_clash'; external_ref: string }
  | { kind: 'control_violation'; account_code: string; reason: string }
  | { kind: 'period_closed'; period_id: string }
  | { kind: 'posted_immutable'; transaction_id: string }
  | { kind: 'validation_blocked'; flags: ValidationFlag[] };
