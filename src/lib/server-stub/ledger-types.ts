/**
 * Stub types mirroring the eventual `types/api.ts` that Backend (Session A)
 * will generate from the Drizzle schema. These shapes follow LEDGER-SPEC v2
 * §3 (transactions + postings) and §5 (five-domain model).
 *
 * When A ships the real module, the consumer just changes the import path —
 * the function signatures and field names are designed to match.
 */

import type { TransactionKind, TransactionStatus } from '@/components/entity/transaction-list';
import type { TransactionPosting, TransactionFlag } from '@/components/entity/transaction-detail';

/** Domain per LEDGER-SPEC §5. */
export type LedgerDomain = 'operating' | 'cogs' | 'owners' | 'tax' | 'non_op';

/** Account from the 24-account chart (LEDGER-SPEC v2 §2). */
export type ChartAccount = {
  code: string;
  name: string;
  domain: LedgerDomain;
  /** Side that increases this account: debit (assets/expense) or credit (liab/equity/income). */
  normalSide: 'debit' | 'credit';
  /** Parent in the hierarchy, e.g. "1000". */
  parentCode?: string | null;
};

/**
 * Result of `createDraftTransaction`. The server returns the draft id plus
 * validation flags. The UI surfaces every flag; `block` flags prevent
 * posting, `warn` flags require an Acknowledge toggle before posting.
 */
export type DraftResult = {
  draftId: string;
  flags: readonly TransactionFlag[];
};

/** Per-client P&L row from LEDGER-SPEC §6.1. */
export type PerClientPnLRow = {
  clientId: string;
  clientName: string;
  /** Revenue domain inflow during the period (paise, bigint). */
  revenuePaise: bigint;
  /** Direct cost (cogs domain) attributed to this client during the period. */
  directCostPaise: bigint;
  /** Gross margin = revenue - directCost (computed by server; UI never re-computes). */
  grossMarginPaise: bigint;
  /** Number of posted transactions touching this client in the period. */
  txnCount: number;
};

/** Per-vendor spend row (used by AP aging and vendor spend reports). */
export type PerVendorSpendRow = {
  vendorId: string;
  vendorName: string;
  totalSpendPaise: bigint;
  openPayablePaise: bigint;
  txnCount: number;
};

/** Trial Balance row (LEDGER-SPEC §6.2). */
export type TrialBalanceRow = {
  accountCode: string;
  accountName: string;
  debitPaise: bigint;
  creditPaise: bigint;
};

/** A statement-of-account row: chronological posting + running balance. */
export type StatementRow = {
  date: string;
  reference: string;
  /** Human document number parsed from `reference` (e.g. "INV 1"), or null. */
  documentNumber: string | null;
  /** Client / vendor / employee this row relates to, or null. */
  counterpartyName: string | null;
  kind: TransactionKind;
  memo: string | null;
  debitPaise: bigint;
  creditPaise: bigint;
  runningBalancePaise: bigint;
  transactionId: string;
};

/** AR / AP aging bucket — buckets are 0-30 / 31-60 / 61-90 / 90+ days. */
export type AgingBucket = '0-30' | '31-60' | '61-90' | '90+';

export type AgingRow = {
  entityId: string;
  entityName: string;
  byBucket: Record<AgingBucket, bigint>;
  totalPaise: bigint;
};

/** Period close state from LEDGER-SPEC §8. */
export type Period = {
  id: string;
  /** "FY26-04" — April of FY 2025-26. */
  label: string;
  startDate: string;
  endDate: string;
  status: 'open' | 'soft_closed' | 'hard_closed';
  closedBy?: string | null;
  closedAt?: string | null;
  reopenReason?: string | null;
};

/** Bank reconciliation row state. */
export type ReconciliationRow = {
  /** Bank statement line. */
  bank: { date: string; description: string; amountPaise: bigint };
  /** Matched transaction id, if any. */
  matchedTransactionId: string | null;
  /** Match status. */
  status: 'matched' | 'manual_match' | 'unmatched' | 'newly_created';
};

/** Tax reference rate (LEDGER-SPEC §7). */
export type TaxReferenceRate = {
  id: string;
  /** e.g. "GST_STANDARD_18", "TDS_194C". */
  code: string;
  label: string;
  ratePct: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
};

/** Validation rule toggle. */
export type ValidationRule = {
  code: string;
  label: string;
  description: string;
  severity: 'block' | 'warn';
  enabled: boolean;
  /** Optional numeric threshold (e.g. "tds_threshold_paise" = 1_00_000n). */
  thresholdPaise?: bigint | null;
};

/** Agency bank account in the vault (LEDGER-SPEC §10.6). */
export type AgencyBankAccount = {
  id: string;
  bankName: string;
  maskedNumber: string;
  ifsc: string;
  accountType: 'savings' | 'current' | 'od' | 'cc';
  isPrimary: boolean;
  /** GL account code this bank account posts to (1100 / 1110 etc.). */
  accountCode: string;
};

// Re-export so consumers have one import.
export type { TransactionKind, TransactionStatus, TransactionPosting };
