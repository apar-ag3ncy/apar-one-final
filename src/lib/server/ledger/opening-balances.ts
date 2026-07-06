'use server';

/**
 * Office opening-balances server action.
 *
 * Records a single opening-balance journal voucher that seeds the ledger at
 * go-live: cash on hand (1110), each agency bank's opening (1120, sub:bank),
 * company assets (1510), and each partner's introduced capital (3100,
 * sub:partner_user_id). The double-entry plug lands in 3900 Opening Balance
 * Equity so the trial balance stays balanced whatever the operator enters.
 *
 * Posting path: this reuses the real ledger orchestrator directly —
 * `getActorContext()` + `createDraftTransaction`/`postTransaction` from
 * `@/lib/server/ledger` — the same way `src/lib/server/billing/agency-banks.ts`
 * posts its opening JV. The stub actions in `src/lib/server-stub/ledger-actions.ts`
 * (`createDraftTransactionTyped` / `postTransaction`) only round-trip a subset
 * of the flag shape and would make acknowledging flags awkward, so we call the
 * orchestrator, which handles CurrentUserContext + capability gating (the
 * journal kind requires `create_journal_voucher` on draft and `post_transaction`
 * on post).
 *
 * The 1120 and 3100 control accounts carry their sub-ledger as
 * `{ entityType: 'office', entityId: <bankAccountId | partnerUserId> }`,
 * matching the convention in `postings/partnerEquity.ts`.
 */

import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { transactions, users } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { getActorContext } from '@/lib/server/actor';
import { createDraftTransaction, postTransaction } from '@/lib/server/ledger';
import { listAgencyBankAccounts } from '@/lib/server/billing/agency-banks';

export type PartnerOption = { id: string; name: string };
export type OpeningBankOption = { id: string; label: string };

export type RecordOpeningBalancesInput = {
  asOfDate: string;
  cashInHandPaise: bigint | string;
  companyAssetsPaise: bigint | string;
  bankLines: Array<{ bankAccountId: string; amountPaise: bigint | string }>;
  partnerLines: Array<{ partnerUserId: string; amountPaise: bigint | string }>;
  notes?: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Coerce a bigint|string paise value to bigint; 0n on empty/invalid. */
function toPaise(v: bigint | string | null | undefined): bigint {
  if (typeof v === 'bigint') return v;
  if (v == null) return 0n;
  const s = String(v).trim();
  if (s === '') return 0n;
  try {
    return BigInt(s);
  } catch {
    throw new AppError('validation', `Invalid amount: ${s}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listPartnerUsers(): Promise<readonly PartnerOption[]> {
  await getActorContext();
  const rows = await db
    .select({ id: users.id, name: users.fullName })
    .from(users)
    .where(eq(users.role, 'partner'))
    .orderBy(asc(users.fullName));
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

export async function listOpeningBankOptions(): Promise<readonly OpeningBankOption[]> {
  // The 1120 sub-ledger banks are the rows of the `bank_accounts` table;
  // listAgencyBankAccounts already reads that table and computes a human label.
  const banks = await listAgencyBankAccounts();
  return banks.map((b) => ({ id: b.id, label: b.label }));
}

export async function getOpeningBalancesStatus(): Promise<{
  alreadyPosted: boolean;
  postedAt: string | null;
}> {
  await getActorContext();
  // Every posted opening-balance JV. postedAt can be null on legacy rows, so
  // pick the max in JS rather than relying on DB ordering + a null guard.
  const rows = await db
    .select({ postedAt: transactions.postedAt })
    .from(transactions)
    .where(and(eq(transactions.sourceKind, 'opening_balance'), eq(transactions.status, 'posted')));
  const alreadyPosted = rows.length > 0;
  let latest: Date | null = null;
  for (const r of rows) {
    if (r.postedAt && (latest === null || r.postedAt > latest)) latest = r.postedAt;
  }
  return { alreadyPosted, postedAt: latest ? latest.toISOString() : null };
}

/* -------------------------------------------------------------------------- */
/* Write                                                                       */
/* -------------------------------------------------------------------------- */

export async function recordOpeningBalances(
  input: RecordOpeningBalancesInput,
): Promise<{ transactionId: string }> {
  const ctx = await getActorContext();

  const asOfDate = String(input.asOfDate ?? '').trim();
  if (!DATE_RE.test(asOfDate)) {
    throw new AppError('validation', 'asOfDate must be a valid YYYY-MM-DD date.');
  }

  type Leg = {
    accountCode: string;
    side: 'debit' | 'credit';
    amountPaise: bigint;
    subledger?: { entityType: 'office'; entityId: string };
  };
  const legs: Leg[] = [];

  // Dr 1110 Cash on Hand (no subledger).
  const cash = toPaise(input.cashInHandPaise);
  if (cash > 0n) {
    legs.push({ accountCode: '1110', side: 'debit', amountPaise: cash });
  }

  // Dr 1120 Bank Accounts per bank line (sub: bank).
  for (const line of input.bankLines ?? []) {
    const amt = toPaise(line.amountPaise);
    if (amt > 0n) {
      legs.push({
        accountCode: '1120',
        side: 'debit',
        amountPaise: amt,
        subledger: { entityType: 'office', entityId: line.bankAccountId },
      });
    }
  }

  // Dr 1510 Office Equipment & Assets (no subledger).
  const assets = toPaise(input.companyAssetsPaise);
  if (assets > 0n) {
    legs.push({ accountCode: '1510', side: 'debit', amountPaise: assets });
  }

  // Cr 3100 Partner Capital per partner line (sub: partner_user_id).
  for (const line of input.partnerLines ?? []) {
    const amt = toPaise(line.amountPaise);
    if (amt > 0n) {
      legs.push({
        accountCode: '3100',
        side: 'credit',
        amountPaise: amt,
        subledger: { entityType: 'office', entityId: line.partnerUserId },
      });
    }
  }

  // Balance with a plug into 3900 Opening Balance Equity (no subledger).
  let debitTotal = 0n;
  let creditTotal = 0n;
  for (const l of legs) {
    if (l.side === 'debit') debitTotal += l.amountPaise;
    else creditTotal += l.amountPaise;
  }
  const plug = debitTotal - creditTotal;
  if (plug > 0n) {
    legs.push({ accountCode: '3900', side: 'credit', amountPaise: plug });
  } else if (plug < 0n) {
    legs.push({ accountCode: '3900', side: 'debit', amountPaise: -plug });
  }

  if (legs.length < 2) {
    throw new AppError('validation', 'Enter at least one opening balance figure.');
  }

  const notes = input.notes ?? null;
  const journalReason = `Opening balances as of ${asOfDate}`; // >= 10 chars
  // external_ref is UNIQUE; append a short time suffix so re-runs / a prior
  // reversed attempt don't clash on the constraint.
  const externalRef = `OPENING-${asOfDate}-${Date.now().toString(36)}`;

  const draft = await createDraftTransaction(ctx, {
    kind: 'journal',
    input: {
      externalRef,
      txnDate: asOfDate,
      journalReason,
      legs,
      isOpeningBalance: true,
      notes,
    },
  });

  await postTransaction(ctx, {
    transactionId: draft.transactionId,
    acknowledgedFlags: draft.validationFlags.map((f) => f.code),
  });

  return { transactionId: draft.transactionId };
}
