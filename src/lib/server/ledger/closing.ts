import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { db, type DbClient } from '@/lib/db/client';
import { periods } from '@/lib/db/schema/periods';
import { transactions } from '@/lib/db/schema/transactions';
import { AppError } from '@/lib/errors';
import { requireCapability, type CurrentUserContext } from '@/lib/rbac';

import { createDraftTransaction, postTransaction } from './transactions';

/**
 * Year-end closing JV — moves every P&L account balance into
 * `3300 Retained Earnings`. Run only when all 12 periods for the
 * fiscal year are `closed`.
 *
 *   For every account with `type IN ('income','expense')`:
 *     If the account has a credit balance (revenue) → Dr the account,
 *       Cr Retained Earnings.
 *     If the account has a debit balance (expense) → Dr Retained
 *       Earnings, Cr the account.
 *   Result: every P&L account balance is zero on day 1 of the next
 *   FY; net profit/loss sits in 3300.
 *
 * Idempotent via `external_ref = closing:FY{year}` — the
 * `external_ref_clash` validation rule already blocks duplicates.
 * sourceKind='closing' so reports can filter the entry out when
 * presenting "this year" P&L numbers.
 *
 * Capability: `close_period` (since this is the natural consequence
 * of hard-closing the twelfth month — the partner running the close
 * already holds the capability).
 */
export async function closeFiscalYear(
  ctx: CurrentUserContext,
  args: { fiscalYear: number; txnDate?: string },
  client: DbClient = db,
): Promise<{ transactionId: string; netProfitPaise: bigint }> {
  requireCapability(ctx, 'close_period');

  const fy = args.fiscalYear;
  const closeDate = args.txnDate ?? `${fy}-03-31`;

  return client.transaction(async (tx) => {
    // 1. Verify all 12 periods for this FY are status='closed'.
    const periodRows = await tx
      .select({ month: periods.month, status: periods.status })
      .from(periods)
      .where(eq(periods.fiscalYear, fy));
    if (periodRows.length === 0) {
      throw new AppError('not_found', `No periods seeded for FY${fy}`);
    }
    const monthsClosed = periodRows.filter((p) => p.status === 'closed').length;
    if (monthsClosed !== periodRows.length) {
      throw new AppError(
        'validation',
        `FY${fy} closing requires every period hard-closed; ${monthsClosed}/${periodRows.length} are closed.`,
      );
    }

    // 2. Aggregate balance per P&L account up to the close date,
    //    excluding any prior closing entries (they'd be self-cancelling).
    //    Credit-balance accounts (income) → Dr them on close.
    //    Debit-balance accounts (expense) → Cr them on close.
    const balances = await tx.execute<{
      code: string;
      type: 'income' | 'expense';
      debit: string;
      credit: string;
    }>(sql`
      SELECT
        a.code,
        a.type::text AS type,
        COALESCE(SUM(p.amount_paise) FILTER (WHERE p.side = 'debit'), 0)::text AS debit,
        COALESCE(SUM(p.amount_paise) FILTER (WHERE p.side = 'credit'), 0)::text AS credit
      FROM accounts a
      LEFT JOIN postings p ON p.account_id = a.id
      LEFT JOIN transactions t ON t.id = p.transaction_id
        AND t.status = 'posted'
        AND t.reverses_id IS NULL
        AND t.source_kind <> 'closing'
        AND t.txn_date <= ${closeDate}::date
      WHERE a.type IN ('income', 'expense')
        AND a.is_active = true
      GROUP BY a.code, a.type
      HAVING COALESCE(SUM(p.amount_paise) FILTER (WHERE p.side = 'debit'), 0)
           <> COALESCE(SUM(p.amount_paise) FILTER (WHERE p.side = 'credit'), 0)
    `);

    type Leg = {
      accountCode: string;
      side: 'debit' | 'credit';
      amountPaise: bigint;
    };
    const legs: Leg[] = [];
    let netCredit = 0n; // income net of expense; this is the close-out delta
    for (const r of Array.isArray(balances) ? balances : []) {
      const debit = BigInt(r.debit);
      const credit = BigInt(r.credit);
      const balance = credit - debit;
      if (balance === 0n) continue;
      if (balance > 0n) {
        // Credit-balance account (income) — debit it to zero out.
        legs.push({ accountCode: r.code, side: 'debit', amountPaise: balance });
        netCredit += balance;
      } else {
        // Debit-balance account (expense) — credit it to zero out.
        legs.push({ accountCode: r.code, side: 'credit', amountPaise: -balance });
        netCredit -= -balance;
      }
    }

    if (legs.length === 0) {
      throw new AppError(
        'validation',
        `FY${fy} has no posted P&L activity to close. Either there are no transactions or every account already nets to zero.`,
      );
    }

    // 3. Plug to 3300 Retained Earnings on the opposite side.
    if (netCredit > 0n) {
      // Net income → credit retained earnings.
      legs.push({ accountCode: '3300', side: 'credit', amountPaise: netCredit });
    } else {
      // Net loss → debit retained earnings.
      legs.push({ accountCode: '3300', side: 'debit', amountPaise: -netCredit });
    }

    // 4. Post via the journal template. external_ref idempotency: the
    //    external_ref_clash validation rule already blocks duplicates.
    const draft = await createDraftTransaction(
      ctx,
      {
        kind: 'journal',
        input: {
          externalRef: `closing:FY${fy}`,
          txnDate: closeDate,
          journalReason: `Year-end close for FY${fy}: roll P&L into 3300 Retained Earnings.`,
          legs,
          isOpeningBalance: false,
          notes: null,
        },
      },
      tx as unknown as DbClient,
    );

    // 5. Mark the txn as sourceKind='closing' before posting so reports
    //    can filter on it. The journal template sets sourceKind='journal';
    //    we override.
    await tx
      .update(transactions)
      .set({ sourceKind: 'closing' })
      .where(and(eq(transactions.id, draft.transactionId)));

    await postTransaction(
      ctx,
      { transactionId: draft.transactionId, acknowledgedFlags: [] },
      tx as unknown as DbClient,
    );

    return { transactionId: draft.transactionId, netProfitPaise: netCredit };
  });
}
