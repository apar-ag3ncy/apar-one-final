'use server';

import { and, asc, eq, gte, inArray, isNull, lte, ne, notInArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { accounts, clients, employees, postings, transactions, vendors } from '@/lib/db/schema';
import { getActorContext } from '@/lib/server/actor';

/**
 * Turn a transaction's opaque `external_ref` into a human document number for
 * the ledger "Particulars" column. Refs are `<prefix>:<...>`:
 *   - `client_invoice:1`                → INV 1
 *   - `vendor_bill:<vendorId>:1231`     → 1231 (the vendor's own bill number)
 *   - `credit_note:CN-3` / `receipt:RV-2` / `advance:AV-4` / `refund_voucher:RF-1`
 *                                       → the suffix (already a doc number)
 *   - `crcpt:<clientId>:<ts>` / `vpv:<vendorId>:<ts>` / `obe:…` / `closing:…`
 *                                       → no clean doc number → null (caller
 *                                         falls back to the human description)
 */
function resolveDocumentNumber(reference: string): string | null {
  const parts = reference.split(':');
  const prefix = parts[0];
  switch (prefix) {
    case 'client_invoice': {
      const n = parts.slice(1).join(':');
      if (!n) return null;
      // Full doc numbers (e.g. "INV/2026-27/0001") already read as invoices;
      // only bare sequence numbers get an "INV " prefix for clarity.
      return /[a-zA-Z]/.test(n) ? n : `INV ${n}`;
    }
    case 'vendor_bill':
      // vendor_bill:<vendorId>:<their invoice no> — the number is everything
      // after the vendor id (may itself contain colons).
      return parts.length >= 3 ? parts.slice(2).join(':') : null;
    case 'credit_note':
    case 'receipt':
    case 'advance':
    case 'refund_voucher':
      return parts.slice(1).join(':') || null;
    default:
      // crcpt / vpv / obe / closing / journal / advance_adjustment: the suffix
      // is an id + timestamp, not a document number.
      return null;
  }
}

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
  /** Human document number parsed from `reference` (e.g. "INV 1", "1231"), or null. */
  documentNumber: string | null;
  /** Client / vendor / employee this line relates to, or null (e.g. pure office JVs). */
  counterpartyName: string | null;
  /** Our bank/cash account the money moved through, "Display name (••1234)" /
   * "Cash", or null for txns with no cash leg (invoices, bills, JVs). */
  bankAccountLabel: string | null;
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
  documentNumber: string | null;
  counterpartyName: string | null;
  bankAccountLabel: string | null;
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
    | {
        kind: 'subledger';
        entityType: 'client' | 'vendor';
        entityId: string;
        /** Restrict to these account codes. Client/vendor invoices ALSO sub-ledger
         * their revenue/cost leg (4100/5100) to the entity, which would net into
         * the "what they owe" balance — pass only the receivable/payable +
         * advance/reimbursable accounts so the statement reads as a true
         * statement of account. */
        accountCodes?: readonly string[];
      }
    | { kind: 'accountCodes'; codes: readonly string[] }
    | { kind: 'bankAccount'; bankAccountId: string }
    | { kind: 'incurredByEmployee'; employeeId: string },
  opts: { from?: string; to?: string; includeReversed?: boolean },
): Promise<RawLine[]> {
  const conds = [] as Array<ReturnType<typeof eq>>;
  if (filter.kind === 'subledger') {
    conds.push(eq(postings.subledgerEntityType, filter.entityType));
    conds.push(eq(postings.subledgerEntityId, filter.entityId));
    if (filter.accountCodes) conds.push(inArray(accounts.code, filter.accountCodes));
  } else if (filter.kind === 'incurredByEmployee') {
    // Salaries/bonuses/reimbursements post to non-control accounts (6100, …)
    // that carry no posting sub-ledger — the employee is attributed on the
    // transaction HEADER via incurred_by_employee_id. Filter on that, and drop
    // the office cash/bank clearing legs (1110/1120) so the running total reads
    // as cumulative pay to this employee, not a nets-to-zero double entry
    // (mirrors how the client/vendor statements show only the entity-side leg).
    conds.push(eq(transactions.incurredByEmployeeId, filter.employeeId));
    conds.push(notInArray(accounts.code, ['1110', '1120']));
  } else if (filter.kind === 'bankAccount') {
    // Each agency bank is a sub-ledger entry on 1120 Bank Accounts, carried
    // as subledger (office, bankAccountId) — exactly how clientPaymentReceived
    // / vendorPaymentMade / the opening-balance JV post the cash leg. Pin the
    // account code to 1120 so we never pick up the partner-equity 'office'
    // postings (3100/3200) that share the synthetic 'office' entity type.
    conds.push(eq(accounts.code, '1120'));
    conds.push(eq(postings.subledgerEntityType, 'office'));
    conds.push(eq(postings.subledgerEntityId, filter.bankAccountId));
  } else {
    conds.push(inArray(accounts.code, filter.codes as string[]));
  }
  if (opts.from) conds.push(gte(transactions.txnDate, opts.from));
  if (opts.to) conds.push(lte(transactions.txnDate, opts.to));
  // Show drafts AND posted transactions — operators need to see what's
  // recorded even before posting, otherwise "I just entered the rent
  // but the ledger is empty" reads as a bug. A reversal nets out as a
  // PAIR: the original flips to status='reversed' while the contra entry
  // stays status='posted' with reverses_id set. Excluding only the
  // 'reversed' original would leave the contra behind and skew the
  // running balance, so drop BOTH sides (matching reports.ts:
  // `status='posted' AND reverses_id IS NULL`). Caller opts back in via
  // includeReversed.
  if (!opts.includeReversed) {
    conds.push(ne(transactions.status, 'reversed'));
    conds.push(isNull(transactions.reversesId));
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
      // The counterparty is attributed on the transaction header
      // (related_entity_id). uuids are globally unique, so an unconditional
      // left-join against each entity table is safe — at most one matches.
      counterpartyName: sql<
        string | null
      >`COALESCE(${clients.name}, ${vendors.name}, ${employees.fullName})`,
      // The cash leg of this transaction, resolved to a human label: our
      // bank account "Display name (••1234)" (1120, sub-ledgered to
      // bank_accounts.id) or "Cash" (1110). Null when the txn moves no
      // cash — invoices, bills, pure JVs.
      bankAccountLabel: sql<string | null>`(
        SELECT CASE
          WHEN a2.code = '1110' THEN 'Cash'
          WHEN a2.code = '1120' THEN ba.display_name || ' (••' || ba.account_last4 || ')'
        END
        FROM postings p2
        JOIN accounts a2 ON a2.id = p2.account_id
        LEFT JOIN bank_accounts ba ON ba.id = p2.subledger_entity_id
        WHERE p2.transaction_id = ${transactions.id} AND a2.code IN ('1110', '1120')
        LIMIT 1
      )`,
      accountCode: accounts.code,
      accountName: accounts.name,
      side: postings.side,
      amountPaise: postings.amountPaise,
    })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .leftJoin(clients, eq(clients.id, transactions.relatedEntityId))
    .leftJoin(vendors, eq(vendors.id, transactions.relatedEntityId))
    .leftJoin(employees, eq(employees.id, transactions.relatedEntityId))
    .where(and(...conds))
    // Use txn_date as primary sort; tie-break on createdAt for stable
    // ordering when multiple postings share a date.
    .orderBy(asc(transactions.txnDate), asc(transactions.createdAt), asc(postings.createdAt));

  return rows.map((r) => ({
    postingId: r.postingId,
    txnId: r.txnId,
    txnDate: r.txnDate,
    reference: r.reference,
    documentNumber: resolveDocumentNumber(r.reference),
    counterpartyName: r.counterpartyName,
    bankAccountLabel: r.bankAccountLabel,
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
    {
      kind: 'subledger',
      entityType: 'client',
      entityId: args.clientId,
      // Receivable-side accounts only: Trade Receivables (1200), Reimbursable
      // Expenses on Behalf (1240), Client Advances Received (2180). The invoice's
      // Service Revenue (4100) leg is also client-sub-ledgered but is P&L, not a
      // receivable — including it wrongly netted revenue into the balance.
      accountCodes: ['1200', '1240', '2180'],
    },
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
    {
      kind: 'subledger',
      entityType: 'vendor',
      entityId: args.vendorId,
      // Payable-side accounts only: Trade Payables (2110) + Advances to Vendors
      // (1220). The bill's Vendor Costs (5100) leg is also vendor-sub-ledgered
      // but is P&L, not a payable — excluded so the balance is what we owe.
      accountCodes: ['2110', '1220'],
    },
    { from: args.from, to: args.to, includeReversed: args.includeReversed },
  );
  return rollUp(lines, (side) => (side === 'credit' ? 1n : -1n));
}

/**
 * **Per-Employee Statement** — the employee's own ledger. Every posting on a
 * transaction attributed to this employee via `incurred_by_employee_id`
 * (salary_disbursement Dr 6100, plus any bonus / reimbursement / advance
 * attributed the same way), minus the office cash/bank clearing legs.
 *
 * Balance convention: positive = cumulative amount paid to the employee. The
 * 6100 Salaries & Wages leg is a debit (expense), so debit-side postings add to
 * the running total and a reversal's credit subtracts — the headline reads as
 * "total we've paid this person". Mirrors getClientStatement / getVendorStatement
 * so the Employee window's Ledger tab reuses the same StatementOfAccount view.
 */
export async function getEmployeeStatement(args: {
  employeeId: string;
  from?: string;
  to?: string;
  includeReversed?: boolean;
}): Promise<Statement> {
  await getActorContext();
  const lines = await fetchSubledgerLines(
    { kind: 'incurredByEmployee', employeeId: args.employeeId },
    { from: args.from, to: args.to, includeReversed: args.includeReversed },
  );
  return rollUp(lines, (side) => (side === 'debit' ? 1n : -1n));
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
 * **TDS Receivable book** — every posting on 1260 TDS Receivable: TDS that
 * CLIENTS withheld from their payments to us (a Dr on each receipt with TDS).
 * It's an asset — we set it off against our income-tax liability — so debits
 * add to the running total and a credit (claim / refund / reversal) subtracts.
 * Closing balance = TDS credit still to be reconciled with the tax department.
 */
export async function getTdsReceivableStatement(args: {
  from?: string;
  to?: string;
  includeReversed?: boolean;
}): Promise<Statement> {
  await getActorContext();
  const lines = await fetchSubledgerLines(
    { kind: 'accountCodes', codes: ['1260'] },
    { from: args.from, to: args.to, includeReversed: args.includeReversed },
  );
  return rollUp(lines, (side) => (side === 'debit' ? 1n : -1n));
}

/**
 * **TDS Payable book** — every posting on 2130 TDS Payable: TDS we WITHHELD from
 * vendor bills/payments and owe the tax department. It's a liability, so credits
 * (TDS withheld) add to the running total and a debit (remittance) subtracts.
 * Closing balance = TDS collected-not-yet-remitted.
 */
export async function getTdsPayableStatement(args: {
  from?: string;
  to?: string;
  includeReversed?: boolean;
}): Promise<Statement> {
  await getActorContext();
  const lines = await fetchSubledgerLines(
    { kind: 'accountCodes', codes: ['2130'] },
    { from: args.from, to: args.to, includeReversed: args.includeReversed },
  );
  return rollUp(lines, (side) => (side === 'credit' ? 1n : -1n));
}

export type BankBook = Statement & {
  /** Running balance carried in from postings dated before `from` (0 when no `from`). */
  openingCarryPaise: bigint;
};

/**
 * **Per-Bank Book** — every posting on `1120 Bank Accounts` sub-ledgered to one
 * agency bank account, in date order, with a running balance. This is the
 * per-bank tally the user asked for: the opening-balance JV (posted by
 * createAgencyBankAccount) shows up as the first line, and every subsequent
 * receipt / payment / charge moves the running balance. `closingBalancePaise`
 * is the bank's current book balance.
 *
 * Balance convention: bank is an asset, so debits (money in) add and credits
 * (money out) subtract — the running balance reads like a passbook.
 *
 * When `from` is set, postings before it are folded into `openingCarryPaise`
 * (the brought-forward balance) so a date-range view still tallies; the opening
 * JV is part of that carry unless it too falls inside the window.
 */
export async function getBankBook(args: {
  bankAccountId: string;
  from?: string;
  to?: string;
  includeReversed?: boolean;
}): Promise<BankBook> {
  await getActorContext();
  // Pull everything up to `to`; split client-side so we can carry forward
  // pre-`from` movements into the opening balance.
  const all = await fetchSubledgerLines(
    { kind: 'bankAccount', bankAccountId: args.bankAccountId },
    { to: args.to, includeReversed: args.includeReversed },
  );
  const sign = (side: 'debit' | 'credit') => (side === 'debit' ? 1n : -1n);

  let openingCarryPaise = 0n;
  const windowed: RawLine[] = [];
  for (const r of all) {
    if (args.from && r.txnDate < args.from) {
      openingCarryPaise += sign(r.side) * r.amountPaise;
    } else {
      windowed.push(r);
    }
  }

  let running = openingCarryPaise;
  const lines: StatementLine[] = [];
  for (const r of windowed) {
    running += sign(r.side) * r.amountPaise;
    lines.push({ ...r, runningBalancePaise: running });
  }
  return { closingBalancePaise: running, lines, openingCarryPaise };
}
