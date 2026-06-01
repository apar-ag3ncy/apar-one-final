'use server';

/**
 * Stub ledger server actions. Same module path the consumer would use against
 * Backend's real actions — when Session A ships `app/api/ledger/...` or
 * `services/ledger.ts`, swap the imports in form components from this file
 * to that file with no other changes (function signatures are designed to
 * match LEDGER-SPEC v2).
 *
 * Every function returns a plausible-looking result so Phase 4 forms can be
 * exercised end-to-end before the backend lands.
 */

import type {
  AgingRow,
  ChartAccount,
  DraftResult,
  Period,
  PerClientPnLRow,
  PerVendorSpendRow,
  ReconciliationRow,
  StatementRow,
  TrialBalanceRow,
  ValidationRule,
} from './ledger-types';
import type { TransactionFlag } from '@/components/entity/transaction-detail';

/* eslint-disable @typescript-eslint/no-unused-vars */

const SIMULATED_LATENCY_MS = 250;
function delay() {
  return new Promise<void>((resolve) => setTimeout(resolve, SIMULATED_LATENCY_MS));
}

export async function getChartOfAccounts(): Promise<readonly ChartAccount[]> {
  await delay();
  return CHART_OF_ACCOUNTS_FIXTURE;
}

export async function createDraftTransaction(input: {
  kind: string;
  attribution?: 'client' | 'opex' | 'asset';
  clientId?: string;
  projectId?: string;
  expenseAccountCode?: string;
  vendorId?: string;
  lines: readonly {
    description: string;
    hsn?: string;
    quantity?: number;
    unitPricePaise: bigint;
    gstPct?: number;
    tdsSection?: string;
  }[];
  sourceDocumentId?: string;
  reason?: string;
}): Promise<DraftResult> {
  await delay();
  const flags: TransactionFlag[] = [];
  if (input.kind === 'vendor_bill' && !input.attribution) {
    flags.push({
      id: 'f1',
      severity: 'block',
      code: 'client_attribution_missing',
      message:
        'Vendor bill must declare whether it is for a client, OpEx, or an asset. ' +
        'Per LEDGER-SPEC §0.6, per-client profitability depends on this answer.',
    });
  }
  if (!input.sourceDocumentId) {
    flags.push({
      id: 'f2',
      severity: 'warn',
      code: 'no_source_document',
      message: 'Posting without a source document — extraction step skipped.',
    });
  }
  if (input.lines.length === 0) {
    flags.push({
      id: 'f3',
      severity: 'block',
      code: 'no_line_items',
      message: 'Add at least one line item before posting.',
    });
  }
  return {
    draftId: `draft_${Math.random().toString(36).slice(2, 10)}`,
    flags,
  };
}

export async function postTransaction(args: {
  draftId: string;
  acknowledgedFlagIds: readonly string[];
}): Promise<{ ok: true; transactionId: string } | { ok: false; message: string }> {
  await delay();
  return {
    ok: false,
    message:
      'Backend `postTransaction` not yet shipped. Draft accepted; posting blocked. ' +
      'See STATUS.md for the open dependency on A.',
  };
}

export async function reverseTransactions(args: {
  transactionIds: readonly string[];
  reason: string;
}): Promise<{ ok: true; reversedIds: readonly string[] } | { ok: false; message: string }> {
  await delay();
  return { ok: false, message: 'Backend `reverseTransactions` not yet shipped.' };
}

export async function getPerClientPnL(args: {
  fromDate: string;
  toDate: string;
}): Promise<readonly PerClientPnLRow[]> {
  await delay();
  return [
    {
      clientId: 'cl_001',
      clientName: 'Marigold Coffee Roasters',
      revenuePaise: 24_50_000_00n,
      directCostPaise: 6_85_000_00n,
      grossMarginPaise: 17_65_000_00n,
      txnCount: 18,
    },
    {
      clientId: 'cl_002',
      clientName: 'Sunset Hotels',
      revenuePaise: 18_00_000_00n,
      directCostPaise: 9_20_000_00n,
      grossMarginPaise: 8_80_000_00n,
      txnCount: 22,
    },
    {
      clientId: 'cl_003',
      clientName: 'Atlas Jewellers',
      revenuePaise: 36_75_000_00n,
      directCostPaise: 14_30_000_00n,
      grossMarginPaise: 22_45_000_00n,
      txnCount: 31,
    },
  ];
}

export async function getPerVendorSpend(args: {
  fromDate: string;
  toDate: string;
}): Promise<readonly PerVendorSpendRow[]> {
  await delay();
  return [
    {
      vendorId: 'vn_001',
      vendorName: 'Lightroom Studios',
      totalSpendPaise: 4_25_000_00n,
      openPayablePaise: 1_20_000_00n,
      txnCount: 11,
    },
    {
      vendorId: 'vn_002',
      vendorName: 'Bombay Print House',
      totalSpendPaise: 2_10_000_00n,
      openPayablePaise: 0n,
      txnCount: 7,
    },
    {
      vendorId: 'vn_003',
      vendorName: 'CloudKit India',
      totalSpendPaise: 1_85_000_00n,
      openPayablePaise: 35_000_00n,
      txnCount: 9,
    },
  ];
}

export async function getTrialBalance(args: {
  asOfDate: string;
  includeReversed?: boolean;
}): Promise<readonly TrialBalanceRow[]> {
  await delay();
  return CHART_OF_ACCOUNTS_FIXTURE.slice(0, 12).map((a, i) => ({
    accountCode: a.code,
    accountName: a.name,
    debitPaise: a.normalSide === 'debit' ? BigInt((i + 1) * 1_25_000_00) : 0n,
    creditPaise: a.normalSide === 'credit' ? BigInt((i + 1) * 1_25_000_00) : 0n,
  }));
}

export async function getStatementOfAccount(args: {
  entityType: 'client' | 'vendor';
  entityId: string;
  fromDate: string;
  toDate: string;
}): Promise<readonly StatementRow[]> {
  await delay();
  return [
    {
      date: '2026-04-15',
      reference: 'INV-26-0042',
      kind: 'client_invoice',
      memo: 'April retainer',
      debitPaise: 2_50_000_00n,
      creditPaise: 0n,
      runningBalancePaise: 2_50_000_00n,
      transactionId: 'tx_001',
    },
    {
      date: '2026-05-02',
      reference: 'RCP-26-0019',
      kind: 'payment_received',
      memo: 'Bank transfer',
      debitPaise: 0n,
      creditPaise: 2_50_000_00n,
      runningBalancePaise: 0n,
      transactionId: 'tx_002',
    },
  ];
}

export async function getAgingReport(args: {
  side: 'receivable' | 'payable';
  asOfDate: string;
}): Promise<readonly AgingRow[]> {
  await delay();
  return [
    {
      entityId: 'cl_001',
      entityName: 'Marigold Coffee Roasters',
      byBucket: { '0-30': 1_50_000_00n, '31-60': 0n, '61-90': 0n, '90+': 0n },
      totalPaise: 1_50_000_00n,
    },
    {
      entityId: 'cl_002',
      entityName: 'Sunset Hotels',
      byBucket: { '0-30': 0n, '31-60': 75_000_00n, '61-90': 0n, '90+': 0n },
      totalPaise: 75_000_00n,
    },
  ];
}

export async function getPeriods(): Promise<readonly Period[]> {
  await delay();
  return [
    {
      id: 'p-26-04',
      label: 'FY26-04 (Apr)',
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      status: 'soft_closed',
    },
    {
      id: 'p-26-05',
      label: 'FY26-05 (May)',
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      status: 'open',
    },
  ];
}

export async function setPeriodStatus(args: {
  periodId: string;
  next: 'open' | 'soft_closed' | 'hard_closed';
  reopenReason?: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  await delay();
  return { ok: false, message: 'Backend `setPeriodStatus` not yet shipped.' };
}

export async function getValidationRules(): Promise<readonly ValidationRule[]> {
  await delay();
  return [
    {
      code: 'client_attribution_missing',
      label: 'Client attribution required on vendor bills',
      description:
        'Per LEDGER-SPEC §0.6, every vendor bill must declare client / OpEx / asset attribution. ' +
        'Disabling this rule breaks per-client P&L.',
      severity: 'block',
      enabled: true,
    },
    {
      code: 'gst_subtotal_mismatch',
      label: 'GST subtotal mismatch',
      description: 'Sum of line items + GST + TDS withholding != stated total.',
      severity: 'warn',
      enabled: true,
      thresholdPaise: 100n,
    },
    {
      code: 'period_close_enforced',
      label: 'Enforce period close',
      description:
        'When enabled, no transactions can be posted into a soft-closed or hard-closed period.',
      severity: 'block',
      enabled: false,
    },
  ];
}

/**
 * 24-account chart (LEDGER-SPEC v2 §2). Trimmed names; full descriptions
 * live on the backend.
 */
const CHART_OF_ACCOUNTS_FIXTURE: readonly ChartAccount[] = [
  { code: '1100', name: 'Bank — HDFC Current', domain: 'operating', normalSide: 'debit' },
  { code: '1110', name: 'Bank — ICICI Current', domain: 'operating', normalSide: 'debit' },
  { code: '1150', name: 'Cash on hand', domain: 'operating', normalSide: 'debit' },
  { code: '1200', name: 'Trade Receivables — Domestic', domain: 'operating', normalSide: 'debit' },
  { code: '1210', name: 'Trade Receivables — Export', domain: 'operating', normalSide: 'debit' },
  { code: '1300', name: 'Input GST — IGST', domain: 'tax', normalSide: 'debit' },
  { code: '1310', name: 'Input GST — CGST', domain: 'tax', normalSide: 'debit' },
  { code: '1320', name: 'Input GST — SGST', domain: 'tax', normalSide: 'debit' },
  { code: '1500', name: 'Advances to vendors', domain: 'operating', normalSide: 'debit' },
  { code: '1510', name: 'Fixed Assets — at cost', domain: 'operating', normalSide: 'debit' },
  { code: '2100', name: 'Trade Payables', domain: 'operating', normalSide: 'credit' },
  { code: '2150', name: 'TDS payable — 194C', domain: 'tax', normalSide: 'credit' },
  { code: '2155', name: 'TDS payable — 194J', domain: 'tax', normalSide: 'credit' },
  { code: '2160', name: 'Output GST — IGST', domain: 'tax', normalSide: 'credit' },
  { code: '2170', name: 'Output GST — CGST/SGST', domain: 'tax', normalSide: 'credit' },
  {
    code: '2180',
    name: 'Advances received from clients',
    domain: 'operating',
    normalSide: 'credit',
  },
  { code: '2200', name: 'Salaries payable', domain: 'operating', normalSide: 'credit' },
  { code: '3100', name: 'Partner capital', domain: 'owners', normalSide: 'credit' },
  { code: '3200', name: 'Partner drawings', domain: 'owners', normalSide: 'debit' },
  { code: '4100', name: 'Service revenue', domain: 'operating', normalSide: 'credit' },
  { code: '5100', name: 'Direct project cost', domain: 'cogs', normalSide: 'debit' },
  { code: '6100', name: 'Rent', domain: 'operating', normalSide: 'debit' },
  { code: '6200', name: 'Utilities', domain: 'operating', normalSide: 'debit' },
  { code: '6300', name: 'Salaries', domain: 'operating', normalSide: 'debit' },
];

export async function getReconciliationCandidates(args: {
  bankAccountId: string;
  statementFile?: never;
}): Promise<readonly ReconciliationRow[]> {
  await delay();
  return [
    {
      bank: { date: '2026-05-12', description: 'NEFT/MARIGOLD/INV0042', amountPaise: 2_50_000_00n },
      matchedTransactionId: 'tx_002',
      status: 'matched',
    },
    {
      bank: { date: '2026-05-14', description: 'CC POS / Adobe Sub', amountPaise: -4_999_00n },
      matchedTransactionId: null,
      status: 'unmatched',
    },
  ];
}
