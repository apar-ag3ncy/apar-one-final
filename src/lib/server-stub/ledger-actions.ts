'use server';

/**
 * Ledger server actions — adapter layer between the form/report UI and the
 * real backend at `src/lib/server/ledger/*`.
 *
 * History: this module shipped as a Phase 4 stub that returned fixture data
 * (see git blame for the previous fictional bodies). The reports + period UI
 * imported from here on the assumption that Session A's real backend would
 * eventually land at the same path. The real backend lives at
 * `src/lib/server/ledger/` today — its function names + types overlap
 * heavily with the stub's, but the exact shapes differ (per-kind
 * discriminated union for `createDraftTransaction`, no `txnCount` on
 * `ClientPnlRow`, `getStatementOfAccount` split into client/vendor/office
 * variants, etc).
 *
 * Rather than rewrite every callsite, we keep the stub's path + signatures
 * intact and translate to/from the real backend's shapes in here. As call
 * sites move to the real types directly, individual adapters here can be
 * deleted.
 *
 * Functions deferred (still throw "not yet shipped"):
 *   - `getPeriods` / `setPeriodStatus`            → P1.3 will land
 *     `src/lib/server/ledger/periods.ts`; we proxy from there.
 *   - `getReconciliationCandidates`               → P5 ships the matcher.
 *
 * Forms still feed the discriminated-union shape via the new
 * `createDraftTransactionLegacy` shim until P1.1b rewrites them.
 */

import { db } from '@/lib/db/client';
import { accounts, documents, validationRules as validationRulesTable } from '@/lib/db/schema';
import { asc, eq } from 'drizzle-orm';

import { getActorContext } from '@/lib/server/actor';
import {
  getApAging as realGetApAging,
  getArAging as realGetArAging,
  getPerClientPnL as realGetPerClientPnL,
  getTrialBalance as realGetTrialBalance,
} from '@/lib/server/ledger/reports';
import {
  listPeriods as realListPeriods,
  setPeriodStatus as realSetPeriodStatus,
} from '@/lib/server/ledger/periods';
import {
  getClientStatement,
  getOfficeStatement,
  getVendorStatement,
} from '@/lib/server/ledger/statements';
import {
  createDraftTransaction as realCreateDraftTransaction,
  postTransaction as realPostTransaction,
  reverseTransaction as realReverseTransaction,
  type TransactionKindInput,
} from '@/lib/server/ledger/transactions';

import type {
  AgingBucket,
  AgingRow,
  ChartAccount,
  DraftResult,
  LedgerDomain,
  Period,
  PerClientPnLRow,
  PerVendorSpendRow,
  ReconciliationRow,
  StatementRow,
  TrialBalanceRow,
  ValidationRule,
} from './ledger-types';
import type { TransactionFlag } from '@/components/entity/transaction-detail';
import type { TransactionKind } from '@/components/entity/transaction-list';

/* eslint-disable @typescript-eslint/no-unused-vars */

/* -------------------------------------------------------------------------- */
/* Read-side adapters                                                         */
/* -------------------------------------------------------------------------- */

const ACCOUNT_TYPE_TO_DOMAIN: Record<string, LedgerDomain> = {
  asset: 'operating',
  liability: 'operating',
  equity: 'owners',
  income: 'operating',
  expense: 'operating',
  contra_asset: 'operating',
};

function normalSideForType(type: string): 'debit' | 'credit' {
  return type === 'asset' || type === 'expense' || type === 'contra_asset' ? 'debit' : 'credit';
}

export async function getChartOfAccounts(): Promise<readonly ChartAccount[]> {
  await getActorContext();
  const rows = await db
    .select({
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      parentId: accounts.parentId,
    })
    .from(accounts)
    .where(eq(accounts.isActive, true))
    .orderBy(asc(accounts.code));

  // Parent codes are looked up via id→code mapping. The chart is small
  // (~25 rows), so the in-memory map is fine.
  const codeById = new Map(rows.map((r, i) => [rows[i]!.code, r.code]));
  void codeById;
  return rows.map(
    (r): ChartAccount => ({
      code: r.code,
      name: r.name,
      domain: ACCOUNT_TYPE_TO_DOMAIN[r.type] ?? 'operating',
      normalSide: normalSideForType(r.type),
      // parent lookup intentionally omitted — the chart is flat in v1.
      // Add it back when the hierarchy is actually populated.
      parentCode: null,
    }),
  );
}

export async function getPerClientPnL(args: {
  fromDate: string;
  toDate: string;
}): Promise<readonly PerClientPnLRow[]> {
  const rows = await realGetPerClientPnL({ from: args.fromDate, to: args.toDate });
  // Stub's PerClientPnLRow carries a `txnCount` the real shape doesn't.
  // Surface 0 — the UI uses it as a soft annotation; the real numbers
  // (revenue / cost / margin) all flow through unchanged.
  return rows.map(
    (r): PerClientPnLRow => ({
      clientId: r.clientId,
      clientName: r.clientName,
      revenuePaise: r.revenuePaise,
      directCostPaise: r.directCostPaise,
      grossMarginPaise: r.grossMarginPaise,
      txnCount: 0,
    }),
  );
}

export async function getPerVendorSpend(args: {
  fromDate: string;
  toDate: string;
}): Promise<readonly PerVendorSpendRow[]> {
  // Per-vendor spend has no real backend yet (paired with the bill_allocations
  // work in P4). Return an empty list until then so the page renders an
  // empty-state rather than fake numbers.
  await getActorContext();
  return [];
}

export async function getTrialBalance(args: {
  asOfDate: string;
  includeReversed?: boolean;
}): Promise<readonly TrialBalanceRow[]> {
  const rows = await realGetTrialBalance({
    asOfDate: args.asOfDate,
    includeReversed: args.includeReversed,
  });
  return rows.map(
    (r): TrialBalanceRow => ({
      accountCode: r.accountCode,
      accountName: r.accountName,
      debitPaise: r.debitPaise,
      creditPaise: r.creditPaise,
    }),
  );
}

export async function getStatementOfAccount(args: {
  entityType: 'client' | 'vendor';
  entityId: string;
  fromDate: string;
  toDate: string;
}): Promise<readonly StatementRow[]> {
  const stmt =
    args.entityType === 'client'
      ? await getClientStatement({
          clientId: args.entityId,
          from: args.fromDate,
          to: args.toDate,
        })
      : await getVendorStatement({
          vendorId: args.entityId,
          from: args.fromDate,
          to: args.toDate,
        });

  // The real Statement returns lines with side+amountPaise; the stub
  // shape splits that into debit/credit columns + a memo (mapped from
  // description). Reference is the txn's external_ref.
  return stmt.lines.map((l) => ({
    date: l.txnDate,
    reference: l.reference,
    kind: l.kind as TransactionKind,
    memo: l.description,
    debitPaise: l.side === 'debit' ? l.amountPaise : 0n,
    creditPaise: l.side === 'credit' ? l.amountPaise : 0n,
    runningBalancePaise: l.runningBalancePaise,
    transactionId: l.txnId,
  }));
}

export async function getOfficeStatementForUi(args: {
  fromDate: string;
  toDate: string;
}): Promise<readonly StatementRow[]> {
  const stmt = await getOfficeStatement({ from: args.fromDate, to: args.toDate });
  return stmt.lines.map((l) => ({
    date: l.txnDate,
    reference: l.reference,
    kind: l.kind as TransactionKind,
    memo: l.description,
    debitPaise: l.side === 'debit' ? l.amountPaise : 0n,
    creditPaise: l.side === 'credit' ? l.amountPaise : 0n,
    runningBalancePaise: l.runningBalancePaise,
    transactionId: l.txnId,
  }));
}

const AGING_ZERO: Record<AgingBucket, bigint> = {
  '0-30': 0n,
  '31-60': 0n,
  '61-90': 0n,
  '90+': 0n,
};

export async function getAgingReport(args: {
  side: 'receivable' | 'payable';
  asOfDate: string;
}): Promise<readonly AgingRow[]> {
  if (args.side === 'payable') {
    const rows = await realGetApAging({ asOfDate: args.asOfDate });
    return rows.map(
      (r): AgingRow => ({
        entityId: r.vendorId,
        entityName: r.vendorName,
        byBucket: {
          '0-30': r.bucket0to30Paise,
          '31-60': r.bucket31to60Paise,
          '61-90': r.bucket61to90Paise,
          '90+': r.bucket90PlusPaise,
        },
        totalPaise: r.totalOutstandingPaise,
      }),
    );
  }
  const rows = await realGetArAging({ asOfDate: args.asOfDate });
  return rows.map(
    (r): AgingRow => ({
      entityId: r.clientId,
      entityName: r.clientName,
      byBucket: {
        '0-30': r.bucket0to30Paise,
        '31-60': r.bucket31to60Paise,
        '61-90': r.bucket61to90Paise,
        '90+': r.bucket90PlusPaise,
      },
      totalPaise: r.totalOutstandingPaise,
    }),
  );
}

export async function getValidationRules(): Promise<readonly ValidationRule[]> {
  await getActorContext();
  const rows = await db
    .select({
      code: validationRulesTable.code,
      description: validationRulesTable.description,
      severity: validationRulesTable.severity,
      isEnabled: validationRulesTable.isEnabled,
      config: validationRulesTable.config,
    })
    .from(validationRulesTable)
    .orderBy(asc(validationRulesTable.code));
  return rows.map(
    (r): ValidationRule => ({
      code: r.code,
      // The stub had separate label + description; the real table only
      // stores a description. Surface the same string for both so the
      // UI keeps rendering — the description carries the human label.
      label: r.code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      description: r.description ?? '',
      severity: (r.severity === 'info' ? 'warn' : r.severity) as 'block' | 'warn',
      enabled: r.isEnabled,
      thresholdPaise:
        r.config && typeof (r.config as Record<string, unknown>).threshold_paise === 'string'
          ? BigInt((r.config as Record<string, string>).threshold_paise!)
          : null,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Period management — minimal proxy until P1.3 ships periods.ts               */
/* -------------------------------------------------------------------------- */

const PERIOD_STATUS_REAL_TO_STUB: Record<string, Period['status']> = {
  open: 'open',
  soft_closed: 'soft_closed',
  // The DB calls it `closed`; the stub UI calls it `hard_closed`.
  closed: 'hard_closed',
};

function fiscalLabel(fiscalYear: number, month: number): string {
  const monthShort = new Date(Date.UTC(2000, (month - 1 + 3) % 12, 1)).toLocaleDateString('en-IN', {
    month: 'short',
  });
  // Indian FY: April = month 1 of the fiscal year. Display as "FY26-04 (Apr)".
  const fy = String(fiscalYear).slice(-2);
  return `FY${fy}-${String(month).padStart(2, '0')} (${monthShort})`;
}

export async function getPeriods(): Promise<readonly Period[]> {
  const rows = await realListPeriods();
  return rows.map(
    (r): Period => ({
      id: r.id,
      label: fiscalLabel(r.fiscalYear, r.month),
      startDate: r.startsOn,
      endDate: r.endsOn,
      status: PERIOD_STATUS_REAL_TO_STUB[r.status] ?? 'open',
      closedBy: r.closedBy ?? null,
      closedAt: r.closedAt ? r.closedAt.toISOString() : null,
      reopenReason: r.reopenReason ?? null,
    }),
  );
}

// Stub status names → real DB status names. The UI calls
// the fully-closed state "hard_closed"; the DB column calls it "closed".
const PERIOD_STATUS_STUB_TO_REAL: Record<
  'open' | 'soft_closed' | 'hard_closed',
  'open' | 'soft_closed' | 'closed'
> = {
  open: 'open',
  soft_closed: 'soft_closed',
  hard_closed: 'closed',
};

export async function setPeriodStatus(args: {
  periodId: string;
  next: 'open' | 'soft_closed' | 'hard_closed';
  reopenReason?: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await getActorContext();
  try {
    await realSetPeriodStatus(ctx, {
      periodId: args.periodId,
      next: PERIOD_STATUS_STUB_TO_REAL[args.next],
      reason: args.reopenReason,
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Could not change period status.',
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Write-side — adapter for the legacy form shape                              */
/*                                                                            */
/* The legacy stub took a flat `{kind, lines[], attribution, ...}` payload.   */
/* The real backend takes a discriminated union per kind. P1.1b rewrites the  */
/* /ledger/new/* forms to feed the real shapes directly. Until those forms    */
/* are rewritten, this adapter surfaces a structured "not wired" response so  */
/* the existing flag-display code still has block-severity flags to render —  */
/* matches the pre-existing behaviour where posts never actually landed.      */
/* -------------------------------------------------------------------------- */

export async function createDraftTransaction(input: {
  kind: string;
  attribution?: 'client' | 'opex' | 'asset';
  clientId?: string;
  projectId?: string;
  expenseAccountCode?: string;
  vendorId?: string;
  billNumber?: string;
  billDate?: string;
  memo?: string;
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
  const ctx = await getActorContext();
  if (input.kind === 'vendor_bill') {
    const flags: TransactionFlag[] = [];
    if (!input.vendorId) {
      flags.push({
        id: 'f_vendor',
        severity: 'block',
        code: 'vendor_missing',
        message: 'Choose a vendor before creating the draft.',
      });
    }
    if (!input.attribution) {
      flags.push({
        id: 'f_attr',
        severity: 'block',
        code: 'client_attribution_missing',
        message:
          'Vendor bill must declare whether it is for a client, OpEx, or an asset. Per-client profitability depends on this answer.',
      });
    }
    if (input.attribution === 'client' && !input.clientId) {
      flags.push({
        id: 'f_client',
        severity: 'block',
        code: 'client_missing',
        message: 'Choose the client this vendor bill is for.',
      });
    }
    if (input.attribution === 'opex' && !input.expenseAccountCode) {
      flags.push({
        id: 'f_expense',
        severity: 'block',
        code: 'expense_account_missing',
        message: 'Choose the expense account for this OpEx bill.',
      });
    }
    if (!input.billNumber) {
      flags.push({
        id: 'f_bill_number',
        severity: 'block',
        code: 'bill_number_missing',
        message: 'Enter the vendor bill number.',
      });
    }
    const validLines = input.lines.filter(
      (line) =>
        line.description.trim().length > 0 &&
        BigInt(Math.max(0, Math.floor(line.quantity ?? 1))) * line.unitPricePaise > 0n,
    );
    if (validLines.length === 0) {
      flags.push({
        id: 'f_lines',
        severity: 'block',
        code: 'no_line_items',
        message: 'Add at least one line item with a description and amount before posting.',
      });
    }
    if (flags.length > 0) {
      return { draftId: `invalid_${Math.random().toString(36).slice(2, 10)}`, flags };
    }

    try {
      const sourceDocumentId =
        input.sourceDocumentId ??
        (await createPlaceholderVendorBillDocument({
          vendorId: input.vendorId!,
          filename: `${input.billNumber}.pdf`,
          userId: ctx.userId,
        }));
      const lineItems = validLines.map((line) => {
        const quantity = BigInt(Math.max(0, Math.floor(line.quantity ?? 1)));
        const amountPaise = quantity * line.unitPricePaise;
        const gstAmountPaiseCaptured =
          (amountPaise * BigInt(Math.max(0, Math.floor((line.gstPct ?? 0) * 100)))) / 10000n;
        return {
          description: line.description,
          amountPaise,
          gstAmountPaiseCaptured,
        };
      });
      const common = {
        vendorId: input.vendorId!,
        billDocumentId: sourceDocumentId,
        vendorInvoiceNumber: input.billNumber!,
        txnDate: input.billDate ?? new Date().toISOString().slice(0, 10),
        lineItems,
        tdsAmountPaise: 0n,
        tdsSection: '' as const,
        isRcm: false,
        notes: input.memo,
      };
      const kindInput: TransactionKindInput =
        input.attribution === 'client'
          ? {
              kind: 'vendor_bill',
              input: {
                ...common,
                attribution: 'client',
                onBehalfOfClientId: input.clientId!,
                projectId: input.projectId || undefined,
              },
            }
          : input.attribution === 'opex'
            ? {
                kind: 'vendor_bill',
                input: {
                  ...common,
                  attribution: 'opex',
                  expenseAccountCode: input.expenseAccountCode as
                    | '6100'
                    | '6200'
                    | '6300'
                    | '6400'
                    | '6900'
                    | '8100',
                },
              }
            : {
                kind: 'vendor_bill',
                input: {
                  ...common,
                  attribution: 'asset',
                },
              };
      const res = await realCreateDraftTransaction(ctx, kindInput);
      return {
        draftId: res.transactionId,
        flags: res.validationFlags.map(
          (f): TransactionFlag => ({
            id: f.code,
            severity: f.severity === 'block' ? 'block' : 'warn',
            code: f.code,
            message: f.message,
          }),
        ),
      };
    } catch (e) {
      return {
        draftId: `invalid_${Math.random().toString(36).slice(2, 10)}`,
        flags: [
          {
            id: 'f_error',
            severity: 'block',
            code: 'vendor_bill_draft_failed',
            message: e instanceof Error ? e.message : 'Could not create vendor bill draft.',
          },
        ],
      };
    }
  }
  const flags: TransactionFlag[] = [
    {
      id: 'f0',
      severity: 'block',
      code: 'typed_form_pending',
      message:
        'The typed-input form for this transaction kind hasn’t shipped yet. To record this ' +
        'transaction today, use the Journal Voucher (/ledger/new/journal-voucher) — it accepts ' +
        'any debit/credit pair against the real chart of accounts and posts to the live ledger. ' +
        'The typed form will ship in a follow-up that replaces this banner with the proper UI.',
    },
  ];
  // Keep the original demo-time block flags so the existing flag-display
  // UI still renders something familiar.
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
  if (input.lines.length === 0) {
    flags.push({
      id: 'f2',
      severity: 'block',
      code: 'no_line_items',
      message: 'Add at least one line item before posting.',
    });
  }
  return {
    draftId: `legacy_${Math.random().toString(36).slice(2, 10)}`,
    flags,
  };
}

async function createPlaceholderVendorBillDocument(args: {
  vendorId: string;
  filename: string;
  userId: string;
}): Promise<string> {
  const [row] = await db
    .insert(documents)
    .values({
      entityType: 'vendor',
      entityId: args.vendorId,
      bucket: 'internal-docs',
      storagePath: `manual/vendor-bills/${args.vendorId}/${Date.now()}-${args.filename}`,
      visibility: 'internal',
      category: 'invoice',
      originalFilename: args.filename,
      mimeType: 'application/pdf',
      sizeBytes: 0,
      createdBy: args.userId,
      updatedBy: args.userId,
    })
    .returning({ id: documents.id });
  if (!row) throw new Error('Could not create vendor bill document reference.');
  return row.id;
}

export async function postTransaction(args: {
  draftId: string;
  acknowledgedFlagIds: readonly string[];
}): Promise<{ ok: true; transactionId: string } | { ok: false; message: string }> {
  await getActorContext();
  if (args.draftId.startsWith('legacy_')) {
    return {
      ok: false,
      message:
        'This draft was created via the legacy form path. Wait for the form rewrite (P1.1b) ' +
        'to land — `postTransaction` is wired against the real backend already.',
    };
  }
  // Real path: the draft id is a real transaction UUID. Forms that
  // already feed the real backend will reach this branch.
  const ctx = await getActorContext();
  try {
    const res = await realPostTransaction(ctx, {
      transactionId: args.draftId,
      acknowledgedFlags: args.acknowledgedFlagIds as string[],
    });
    return { ok: true, transactionId: res.transactionId };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not post.' };
  }
}

export async function reverseTransactions(args: {
  transactionIds: readonly string[];
  reason: string;
}): Promise<{ ok: true; reversedIds: readonly string[] } | { ok: false; message: string }> {
  const ctx = await getActorContext();
  const reversed: string[] = [];
  try {
    for (const id of args.transactionIds) {
      const res = await realReverseTransaction(ctx, { transactionId: id, reason: args.reason });
      reversed.push(res.reversalTransactionId);
    }
    return { ok: true, reversedIds: reversed };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not reverse.' };
  }
}

/* -------------------------------------------------------------------------- */
/* Bank reconciliation — placeholder until P5                                  */
/* -------------------------------------------------------------------------- */

export async function getReconciliationCandidates(args: {
  bankAccountId: string;
  statementFile?: never;
}): Promise<readonly ReconciliationRow[]> {
  // Real matcher ships in P5. Returning empty so the recon window
  // renders its "drop a statement here" empty state instead of demo rows.
  await getActorContext();
  return [];
}

/* -------------------------------------------------------------------------- */
/* Direct passthrough for new code: feed the real shape                        */
/* -------------------------------------------------------------------------- */

/**
 * Direct passthrough to the real backend. New form code should import this
 * (or import from `@/lib/server/ledger` directly) and pass a
 * `TransactionKindInput` shape so the posting actually lands.
 */
export async function createDraftTransactionTyped(
  kindInput: TransactionKindInput,
): Promise<{ transactionId: string; flags: readonly TransactionFlag[] }> {
  const ctx = await getActorContext();
  const res = await realCreateDraftTransaction(ctx, kindInput);
  return {
    transactionId: res.transactionId,
    flags: res.validationFlags.map(
      (f): TransactionFlag => ({
        id: f.code,
        severity: f.severity === 'block' ? 'block' : 'warn',
        code: f.code,
        message: f.message,
      }),
    ),
  };
}
