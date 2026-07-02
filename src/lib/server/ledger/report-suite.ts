'use server';

// Additional ledger reports beyond reports.ts / statements.ts, wired into the
// Reports app (OS + Dashboard):
//   - getCashFlowStatement  — direct-method cash movement (1110 + 1120) by kind
//   - getCombinedBankBook   — every agency bank account, per-account + grand total
//   - getDayBook            — chronological journal of every posting in a range
//   - getGstSummary         — GST output (2120) vs input (1250) per month + net
//
// All aggregation is Postgres-side. Reversed transactions are excluded by
// default (status='posted' AND reverses_id IS NULL) to match the rest of the
// engine. This file is 'use server' so the OS client windows can import the
// functions directly (every export must stay async — sync exports break the
// Vercel build).

import { sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { getActorContext } from '@/lib/server/actor';
import { listAgencyBankAccounts } from '@/lib/server/billing/agency-banks';
import { getBankBook, type BankBook } from '@/lib/server/ledger/statements';

const notReversed = (includeReversed: boolean) =>
  includeReversed ? sql`true` : sql`t.reverses_id IS NULL`;

/* ── Cash Flow (direct method) ─────────────────────────────────────────── */

export type CashFlowRow = {
  kind: string;
  inflowPaise: bigint;
  outflowPaise: bigint;
  netPaise: bigint;
};

export type CashFlowStatement = {
  openingPaise: bigint;
  closingPaise: bigint;
  totalInflowPaise: bigint;
  totalOutflowPaise: bigint;
  rows: readonly CashFlowRow[];
};

/**
 * Direct-method cash flow: the net movement of cash + bank (accounts 1110 +
 * 1120) over the range, grouped by transaction kind (payments received,
 * payments made, salaries, transfers…). Opening = position before `from`,
 * closing = opening + net movement.
 */
export async function getCashFlowStatement(args: {
  from: string;
  to: string;
  includeReversed?: boolean;
}): Promise<CashFlowStatement> {
  await getActorContext();
  const inc = args.includeReversed ?? false;

  const openingRows = await db.execute<{ opening: string }>(sql`
    SELECT COALESCE(SUM(CASE WHEN p.side = 'debit' THEN p.amount_paise ELSE -p.amount_paise END), 0)::text AS opening
    FROM postings p
    JOIN accounts a ON a.id = p.account_id
    JOIN transactions t ON t.id = p.transaction_id
    WHERE a.code IN ('1110', '1120') AND t.status = 'posted' AND ${notReversed(inc)}
      AND t.txn_date < ${args.from}::date
  `);
  const openingPaise = BigInt((Array.isArray(openingRows) ? openingRows : [])[0]?.opening ?? '0');

  const rows = await db.execute<{ kind: string; inflow: string; outflow: string }>(sql`
    SELECT t.kind,
      COALESCE(SUM(p.amount_paise) FILTER (WHERE p.side = 'debit'), 0)::text AS inflow,
      COALESCE(SUM(p.amount_paise) FILTER (WHERE p.side = 'credit'), 0)::text AS outflow
    FROM postings p
    JOIN accounts a ON a.id = p.account_id
    JOIN transactions t ON t.id = p.transaction_id
    WHERE a.code IN ('1110', '1120') AND t.status = 'posted' AND ${notReversed(inc)}
      AND t.txn_date >= ${args.from}::date AND t.txn_date <= ${args.to}::date
    GROUP BY t.kind
    ORDER BY (COALESCE(SUM(p.amount_paise) FILTER (WHERE p.side = 'debit'), 0)
            - COALESCE(SUM(p.amount_paise) FILTER (WHERE p.side = 'credit'), 0)) DESC
  `);
  const mapped = (Array.isArray(rows) ? rows : []).map((r) => {
    const inflowPaise = BigInt(r.inflow);
    const outflowPaise = BigInt(r.outflow);
    return { kind: r.kind, inflowPaise, outflowPaise, netPaise: inflowPaise - outflowPaise };
  });
  const totalInflowPaise = mapped.reduce((a, r) => a + r.inflowPaise, 0n);
  const totalOutflowPaise = mapped.reduce((a, r) => a + r.outflowPaise, 0n);

  return {
    openingPaise,
    closingPaise: openingPaise + totalInflowPaise - totalOutflowPaise,
    totalInflowPaise,
    totalOutflowPaise,
    rows: mapped,
  };
}

/* ── Combined Bank Book (all accounts) ─────────────────────────────────── */

export type CombinedBankRow = {
  bankAccountId: string;
  label: string;
  bankName: string;
  accountLast4: string;
  isActive: boolean;
  openingPaise: bigint;
  inflowPaise: bigint;
  outflowPaise: bigint;
  closingPaise: bigint;
  book: BankBook;
};

export type CombinedBankBook = {
  banks: readonly CombinedBankRow[];
  grandOpeningPaise: bigint;
  grandInflowPaise: bigint;
  grandOutflowPaise: bigint;
  grandClosingPaise: bigint;
};

/**
 * Every agency bank account's passbook for the range, with per-account
 * opening / money-in / money-out / closing and a grand total across all
 * accounts. Reuses getBankBook per account.
 */
export async function getCombinedBankBook(args: {
  from: string;
  to: string;
  includeReversed?: boolean;
}): Promise<CombinedBankBook> {
  await getActorContext();
  const accounts = await listAgencyBankAccounts();
  const banks: CombinedBankRow[] = [];
  for (const acc of accounts) {
    const book = await getBankBook({
      bankAccountId: acc.id,
      from: args.from,
      to: args.to,
      includeReversed: args.includeReversed,
    });
    const inflowPaise = book.lines.reduce(
      (a, l) => a + (l.side === 'debit' ? l.amountPaise : 0n),
      0n,
    );
    const outflowPaise = book.lines.reduce(
      (a, l) => a + (l.side === 'credit' ? l.amountPaise : 0n),
      0n,
    );
    banks.push({
      bankAccountId: acc.id,
      label: acc.label,
      bankName: acc.bankName,
      accountLast4: acc.accountLast4,
      isActive: acc.isActive,
      openingPaise: book.openingCarryPaise,
      inflowPaise,
      outflowPaise,
      closingPaise: book.closingBalancePaise,
      book,
    });
  }
  return {
    banks,
    grandOpeningPaise: banks.reduce((a, b) => a + b.openingPaise, 0n),
    grandInflowPaise: banks.reduce((a, b) => a + b.inflowPaise, 0n),
    grandOutflowPaise: banks.reduce((a, b) => a + b.outflowPaise, 0n),
    grandClosingPaise: banks.reduce((a, b) => a + b.closingPaise, 0n),
  };
}

/* ── Day Book (general journal) ────────────────────────────────────────── */

export type DayBookRow = {
  txnId: string;
  txnDate: string;
  reference: string;
  description: string | null;
  kind: string;
  accountCode: string;
  accountName: string;
  debitPaise: bigint;
  creditPaise: bigint;
};

export type DayBook = {
  rows: readonly DayBookRow[];
  totalDebitPaise: bigint;
  totalCreditPaise: bigint;
  truncated: boolean;
};

const DAY_BOOK_CAP = 3000;

/**
 * Chronological journal of every posting in the range (both legs of each
 * transaction), ordered by date. Debits and credits total to the same amount.
 */
export async function getDayBook(args: {
  from: string;
  to: string;
  includeReversed?: boolean;
}): Promise<DayBook> {
  await getActorContext();
  const inc = args.includeReversed ?? false;
  const rows = await db.execute<{
    txn_id: string;
    txn_date: string;
    external_ref: string;
    description: string | null;
    kind: string;
    account_code: string;
    account_name: string;
    side: 'debit' | 'credit';
    amount_paise: string;
  }>(sql`
    SELECT t.id::text AS txn_id, t.txn_date::text AS txn_date, t.external_ref, t.description,
      t.kind, a.code AS account_code, a.name AS account_name, p.side, p.amount_paise::text AS amount_paise
    FROM postings p
    JOIN accounts a ON a.id = p.account_id
    JOIN transactions t ON t.id = p.transaction_id
    WHERE t.status = 'posted' AND ${notReversed(inc)}
      AND t.txn_date >= ${args.from}::date AND t.txn_date <= ${args.to}::date
    ORDER BY t.txn_date ASC, t.created_at ASC, p.created_at ASC
    LIMIT ${DAY_BOOK_CAP + 1}
  `);
  const raw = Array.isArray(rows) ? rows : [];
  const truncated = raw.length > DAY_BOOK_CAP;
  const mapped = raw.slice(0, DAY_BOOK_CAP).map((r) => ({
    txnId: r.txn_id,
    txnDate: r.txn_date,
    reference: r.external_ref,
    description: r.description,
    kind: r.kind,
    accountCode: r.account_code,
    accountName: r.account_name,
    debitPaise: r.side === 'debit' ? BigInt(r.amount_paise) : 0n,
    creditPaise: r.side === 'credit' ? BigInt(r.amount_paise) : 0n,
  }));
  return {
    rows: mapped,
    totalDebitPaise: mapped.reduce((a, r) => a + r.debitPaise, 0n),
    totalCreditPaise: mapped.reduce((a, r) => a + r.creditPaise, 0n),
    truncated,
  };
}

/* ── GST Summary ───────────────────────────────────────────────────────── */

export type GstMonthRow = {
  month: string;
  outputPaise: bigint;
  inputPaise: bigint;
  netPayablePaise: bigint;
};

export type GstSummary = {
  rows: readonly GstMonthRow[];
  totalOutputPaise: bigint;
  totalInputPaise: bigint;
  netPayablePaise: bigint;
};

/**
 * GST summary by month: output GST collected (2120 GST Output Payable, net of
 * adjustments) vs input GST credit (1250 GST Input Credit), and net payable =
 * output − input. Positive net = GST owed to the department.
 */
export async function getGstSummary(args: {
  from: string;
  to: string;
  includeReversed?: boolean;
}): Promise<GstSummary> {
  await getActorContext();
  const inc = args.includeReversed ?? false;
  const rows = await db.execute<{ month: string; output_gst: string; input_gst: string }>(sql`
    SELECT to_char(date_trunc('month', t.txn_date), 'YYYY-MM') AS month,
      (COALESCE(SUM(p.amount_paise) FILTER (WHERE a.code = '2120' AND p.side = 'credit'), 0)
       - COALESCE(SUM(p.amount_paise) FILTER (WHERE a.code = '2120' AND p.side = 'debit'), 0))::text AS output_gst,
      (COALESCE(SUM(p.amount_paise) FILTER (WHERE a.code = '1250' AND p.side = 'debit'), 0)
       - COALESCE(SUM(p.amount_paise) FILTER (WHERE a.code = '1250' AND p.side = 'credit'), 0))::text AS input_gst
    FROM postings p
    JOIN accounts a ON a.id = p.account_id
    JOIN transactions t ON t.id = p.transaction_id
    WHERE a.code IN ('2120', '1250') AND t.status = 'posted' AND ${notReversed(inc)}
      AND t.txn_date >= ${args.from}::date AND t.txn_date <= ${args.to}::date
    GROUP BY 1
    ORDER BY 1
  `);
  const mapped = (Array.isArray(rows) ? rows : []).map((r) => {
    const outputPaise = BigInt(r.output_gst);
    const inputPaise = BigInt(r.input_gst);
    return { month: r.month, outputPaise, inputPaise, netPayablePaise: outputPaise - inputPaise };
  });
  return {
    rows: mapped,
    totalOutputPaise: mapped.reduce((a, r) => a + r.outputPaise, 0n),
    totalInputPaise: mapped.reduce((a, r) => a + r.inputPaise, 0n),
    netPayablePaise: mapped.reduce((a, r) => a + r.netPayablePaise, 0n),
  };
}
