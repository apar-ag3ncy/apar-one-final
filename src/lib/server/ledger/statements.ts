'use server';

import { and, asc, eq, gte, inArray, lte, ne } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { accounts, postings, transactions } from '@/lib/db/schema';
import { getActorContext } from '@/lib/server/actor';

/**
 * Statement-of-account / ledger views per LEDGER-SPEC §5.2.
 *
 * Three flavours:
 *   - getClientStatement  → every posting sub-ledgered to this client,
 *     running balance against Trade Receivables (1200). Positive balance
 *     means the client owes us.
 *   - getVendorStatement  → every posting sub-ledgered to this vendor,
 *     running balance against Trade Payables (2110). Positive balance
 *     means we owe the vendor.
 *   - getOfficeStatement  → every posting on cash / bank accounts
 *     (1110 + 1120). Running balance = our cash + bank position.
 *
 * Reversed transactions are excluded by default — they're a paired
 * reversal entry and rolling them up makes the running balance hop
 * around. Pass includeReversed:true to see them.
 */

export type StatementLine = {
  postingId: string;
  txnId: string;
  txnDate: string;
  reference: string;
  kind: string;
  status: 'draft' | 'pending_approval' | 'posted' | 'reversed' | 'void';
  description: string | null;
  accountCode: string;
  accountName: string;
  side: 'debit' | 'credit';
  amountPaise: bigint;
  /** Cumulative signed balance after this line. See getX functions for sign convention. */
  runningBalancePaise: bigint;
};

export type Statement = {
  /** Sum of all lines' signed contributions to balance. */
  closingBalancePaise: bigint;
  lines: readonly StatementLine[];
};

type RawLine = {
  postingId: string;
  txnId: string;
  txnDate: string;
  reference: string;
  kind: string;
  status: 'draft' | 'pending_approval' | 'posted' | 'reversed' | 'void';
  description: string | null;
  accountCode: string;
  accountName: string;
  side: 'debit' | 'credit';
  amountPaise: bigint;
};

/**
 * Returns one StatementLine per posting matching the filter, with a
 * running balance computed by applying `signedAmount` to each in
 * chronological order.
 */
function rollUp(
  rows: readonly RawLine[],
  /** +1 if the posting on this side increases the displayed balance, -1 otherwise. */
  signFor: (side: 'debit' | 'credit') => 1n | -1n,
): Statement {
  let running = 0n;
  const lines: StatementLine[] = [];
  for (const r of rows) {
    running += signFor(r.side) * r.amountPaise;
    lines.push({ ...r, runningBalancePaise: running });
  }
  return { closingBalancePaise: running, lines };
}

async function fetchSubledgerLines(
  filter:
    | { kind: 'subledger'; entityType: 'client' | 'vendor'; entityId: string }
    | { kind: 'bankAccount'; bankAccountId: string }
    | { kind: 'accountCodes'; codes: readonly string[] }
    | { kind: 'all' },
  opts: { from?: string; to?: string; includeReversed?: boolean },
): Promise<RawLine[]> {
  const conds = [] as Array<ReturnType<typeof eq>>;
  if (filter.kind === 'subledger') {
    conds.push(eq(postings.subledgerEntityType, filter.entityType));
    conds.push(eq(postings.subledgerEntityId, filter.entityId));
  } else if (filter.kind === 'bankAccount') {
    // Bank-account sub-ledger lives on 1120 keyed by bank_accounts.id. The
    // postings carry subledger_entity_type='office' (a placeholder — users.id /
    // bank_accounts.id aren't in the entity_type enum), so pin the account code
    // to 1120 and match the bank id; that pair is unique to this account.
    conds.push(eq(accounts.code, '1120'));
    conds.push(eq(postings.subledgerEntityId, filter.bankAccountId));
  } else if (filter.kind === 'accountCodes') {
    conds.push(inArray(accounts.code, filter.codes as string[]));
  }
  // 'all' → every posting (the day book); no account filter.
  if (opts.from) conds.push(gte(transactions.txnDate, opts.from));
  if (opts.to) conds.push(lte(transactions.txnDate, opts.to));
  // Show drafts AND posted transactions — operators need to see what's
  // recorded even before posting, otherwise "I just entered the rent
  // but the ledger is empty" reads as a bug. Reversed entries are
  // excluded because they pair with their original and visually double
  // the running balance. Caller can opt back in via includeReversed.
  if (!opts.includeReversed) {
    conds.push(ne(transactions.status, 'reversed'));
  }

  const rows = await db
    .select({
      postingId: postings.id,
      txnId: transactions.id,
      txnDate: transactions.txnDate,
      reference: transactions.externalRef,
      kind: transactions.kind,
      status: transactions.status,
      description: transactions.description,
      accountCode: accounts.code,
      accountName: accounts.name,
      side: postings.side,
      amountPaise: postings.amountPaise,
    })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(and(...conds))
    // Use txn_date as primary sort; tie-break on createdAt for stable
    // ordering when multiple postings share a date.
    .orderBy(asc(transactions.txnDate), asc(transactions.createdAt), asc(postings.createdAt));

  return rows.map((r) => ({
    postingId: r.postingId,
    txnId: r.txnId,
    txnDate: r.txnDate,
    reference: r.reference,
    kind: r.kind,
    status: r.status,
    description: r.description,
    accountCode: r.accountCode,
    accountName: r.accountName,
    side: r.side,
    amountPaise: r.amountPaise,
  }));
}

/**
 * **Per-Client Statement** — every posting sub-ledgered to this client.
 *
 * Balance convention: positive = client owes us. Trade Receivables (1200)
 * is an asset that increases with debits and decreases with credits, so
 * debit-side postings add to the balance and credit-side postings
 * subtract. Same convention applies to 1240 / 2180 (also client-
 * sub-ledgered) — debit adds, credit subtracts — so the rolled-up
 * "what's outstanding" reads naturally even when reimbursable expenses
 * or advances are in the mix.
 */
export async function getClientStatement(args: {
  clientId: string;
  from?: string;
  to?: string;
  includeReversed?: boolean;
}): Promise<Statement> {
  await getActorContext();
  const lines = await fetchSubledgerLines(
    { kind: 'subledger', entityType: 'client', entityId: args.clientId },
    { from: args.from, to: args.to, includeReversed: args.includeReversed },
  );
  return rollUp(lines, (side) => (side === 'debit' ? 1n : -1n));
}

/**
 * **Per-Vendor Statement** — every posting sub-ledgered to this vendor.
 *
 * Balance convention: positive = we owe the vendor. Trade Payables
 * (2110) is a liability that increases with credits and decreases with
 * debits, so credit-side postings add to the balance and debit-side
 * postings subtract.
 */
export async function getVendorStatement(args: {
  vendorId: string;
  from?: string;
  to?: string;
  includeReversed?: boolean;
}): Promise<Statement> {
  await getActorContext();
  const lines = await fetchSubledgerLines(
    { kind: 'subledger', entityType: 'vendor', entityId: args.vendorId },
    { from: args.from, to: args.to, includeReversed: args.includeReversed },
  );
  return rollUp(lines, (side) => (side === 'credit' ? 1n : -1n));
}

/**
 * **Office (cash/bank) Statement** — every posting on the cash + bank
 * accounts (1110 + 1120). Positive balance = we have money.
 *
 * Both accounts are asset accounts — debit increases, credit decreases.
 * The line list is the cash flow: receipts on the credit side reduce
 * cash (paying out), debits add cash (receiving). This is the OS
 * "office ledger" the user asked for — and the same shape will service
 * the office-utilities cut by filtering on 6200 once that lands.
 */
export async function getOfficeStatement(args: {
  from?: string;
  to?: string;
  includeReversed?: boolean;
}): Promise<Statement> {
  await getActorContext();
  const lines = await fetchSubledgerLines(
    { kind: 'accountCodes', codes: ['1110', '1120'] },
    { from: args.from, to: args.to, includeReversed: args.includeReversed },
  );
  return rollUp(lines, (side) => (side === 'debit' ? 1n : -1n));
}

/**
 * **Bank book** — every posting on ONE agency bank account (its 1120
 * sub-ledger), in date order, with the running balance. Closing balance is
 * that account's current cash position.
 *
 * The opening balance is just the first posting (a `partner_capital` /
 * `partner_drawing` entry dated the as-of date), so it falls out of the same
 * roll-up — no special-casing. Asset convention: debit adds, credit subtracts.
 */
export async function getBankBook(args: {
  bankAccountId: string;
  from?: string;
  to?: string;
  includeReversed?: boolean;
}): Promise<Statement> {
  await getActorContext();
  const lines = await fetchSubledgerLines(
    { kind: 'bankAccount', bankAccountId: args.bankAccountId },
    { from: args.from, to: args.to, includeReversed: args.includeReversed },
  );
  return rollUp(lines, (side) => (side === 'debit' ? 1n : -1n));
}

/**
 * **Office utilities Statement** — every posting on the rent + utilities
 * expense account (6200 Office Rent & Utilities). Closing balance =
 * total spend in the window.
 *
 * 6200 is an expense account that increases with debits and decreases
 * with credits, so debit-side postings add to the running total (more
 * spend) and credit-side postings subtract (refund, reversal, mis-
 * attribution correction). The headline matches the user's intuition:
 * "how much we spent on rent + utilities in this date range".
 *
 * The chart-of-accounts seed in 0007_ledger.sql defines 6200 as a
 * consolidated bucket covering rent + electricity + internet + water.
 * If the spec later splits it into per-utility accounts (6210 Rent,
 * 6220 Electricity, 6230 Internet, …) widen `codes` here to the new
 * set — the rest of the surface keeps working.
 */
export async function getOfficeUtilitiesStatement(args: {
  from?: string;
  to?: string;
  includeReversed?: boolean;
}): Promise<Statement> {
  await getActorContext();
  const lines = await fetchSubledgerLines(
    { kind: 'accountCodes', codes: ['6200'] },
    { from: args.from, to: args.to, includeReversed: args.includeReversed },
  );
  return rollUp(lines, (side) => (side === 'debit' ? 1n : -1n));
}

/**
 * **Day Book** — every posting in a date range, oldest first: a chronological
 * journal register (date, transaction, account, debit/credit) across ALL
 * accounts. No running balance; it's the raw movement log.
 */
export type DayBookEntry = Omit<StatementLine, 'runningBalancePaise'>;

export async function getDayBook(args: {
  from?: string;
  to?: string;
  includeReversed?: boolean;
}): Promise<readonly DayBookEntry[]> {
  await getActorContext();
  return fetchSubledgerLines(
    { kind: 'all' },
    { from: args.from, to: args.to, includeReversed: args.includeReversed },
  );
}

/**
 * **General Ledger** — every posting on ONE GL account, oldest first, with a
 * running balance in the account's natural direction (assets + expenses are
 * debit-normal; liabilities, equity and income are credit-normal). The
 * account-detail drill-down behind the trial balance.
 */
export async function getGeneralLedger(args: {
  accountCode: string;
  from?: string;
  to?: string;
  includeReversed?: boolean;
}): Promise<Statement> {
  await getActorContext();
  const lines = await fetchSubledgerLines(
    { kind: 'accountCodes', codes: [args.accountCode] },
    { from: args.from, to: args.to, includeReversed: args.includeReversed },
  );
  // Debit-normal accounts: 1xxx assets, 5xxx/6xxx/8xxx expenses.
  const debitNormal = /^[1568]/.test(args.accountCode);
  return rollUp(lines, (side) =>
    debitNormal ? (side === 'debit' ? 1n : -1n) : side === 'credit' ? 1n : -1n,
  );
}

/** Active GL accounts for the General Ledger picker. */
export async function listLedgerAccounts(): Promise<
  ReadonlyArray<{ code: string; name: string; type: string }>
> {
  await getActorContext();
  const rows = await db
    .select({ code: accounts.code, name: accounts.name, type: accounts.type })
    .from(accounts)
    .where(eq(accounts.isActive, true))
    .orderBy(asc(accounts.code));
  return rows;
}
