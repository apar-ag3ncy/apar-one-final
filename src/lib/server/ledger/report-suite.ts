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

/* ── Sales & Purchase Registers ────────────────────────────────────────── */

/** Strip the kind prefix off an external_ref to a human doc number. */
function docNumberOf(kind: string, ref: string): string {
  const parts = ref.split(':');
  if (kind === 'client_invoice') return parts[1] ?? ref;
  if (kind === 'vendor_bill') return parts.slice(2).join(':') || ref; // vendor_bill:<vid>:<no>
  return parts.slice(1).join(':') || ref;
}

export type RegisterRow = {
  txnId: string;
  txnDate: string;
  documentNumber: string;
  partyName: string | null;
  projectName: string | null;
  status: string;
  taxablePaise: bigint;
  gstPaise: bigint;
  totalPaise: bigint;
};

export type Register = {
  rows: readonly RegisterRow[];
  totalTaxablePaise: bigint;
  totalGstPaise: bigint;
  totalPaise: bigint;
};

async function fetchRegister(args: {
  kind: 'client_invoice' | 'vendor_bill';
  taxableCode: string; // 4100 revenue / 5100 vendor cost
  gstCode: string; // 2120 output / 1250 input
  controlCode: string; // 1200 receivable / 2110 payable
  controlSide: 'debit' | 'credit';
  partyTable: 'clients' | 'vendors';
  from: string;
  to: string;
  includeReversed: boolean;
}): Promise<Register> {
  const partyJoin =
    args.partyTable === 'clients'
      ? sql`LEFT JOIN clients party ON party.id = t.related_entity_id`
      : sql`LEFT JOIN vendors party ON party.id = t.related_entity_id`;
  const rows = await db.execute<{
    txn_id: string;
    txn_date: string;
    external_ref: string;
    kind: string;
    status: string;
    party_name: string | null;
    project_name: string | null;
    taxable: string;
    gst: string;
    total: string;
  }>(sql`
    SELECT t.id::text AS txn_id, t.txn_date::text AS txn_date, t.external_ref, t.kind, t.status::text AS status,
      party.name AS party_name, pr.name AS project_name,
      COALESCE(SUM(p.amount_paise) FILTER (WHERE a.code = ${args.taxableCode} AND p.side = ${args.kind === 'client_invoice' ? sql`'credit'` : sql`'debit'`}), 0)::text AS taxable,
      COALESCE(SUM(p.amount_paise) FILTER (WHERE a.code = ${args.gstCode}), 0)::text AS gst,
      COALESCE(SUM(p.amount_paise) FILTER (WHERE a.code = ${args.controlCode} AND p.side = ${args.controlSide === 'debit' ? sql`'debit'` : sql`'credit'`}), 0)::text AS total
    FROM transactions t
    JOIN postings p ON p.transaction_id = t.id
    JOIN accounts a ON a.id = p.account_id
    ${partyJoin}
    LEFT JOIN projects pr ON pr.id = t.project_id
    WHERE t.kind = ${args.kind}
      -- Drafts are INCLUDED (with their status shown) so a freshly-recorded
      -- bill/invoice is visible immediately — same decision the ledger
      -- statements made: "I just entered it but the register is empty" reads
      -- as a bug. Reversed pairs stay excluded.
      AND t.status IN ('draft', 'posted')
      AND ${notReversed(args.includeReversed)}
      AND t.txn_date >= ${args.from}::date AND t.txn_date <= ${args.to}::date
    GROUP BY t.id, t.txn_date, t.external_ref, t.kind, t.status, party.name, pr.name
    ORDER BY t.txn_date ASC, t.created_at ASC
  `);
  const mapped = (Array.isArray(rows) ? rows : []).map((r) => ({
    txnId: r.txn_id,
    txnDate: r.txn_date,
    documentNumber: docNumberOf(r.kind, r.external_ref),
    partyName: r.party_name,
    projectName: r.project_name,
    status: r.status,
    taxablePaise: BigInt(r.taxable),
    gstPaise: BigInt(r.gst),
    totalPaise: BigInt(r.total),
  }));
  return {
    rows: mapped,
    totalTaxablePaise: mapped.reduce((a, r) => a + r.taxablePaise, 0n),
    totalGstPaise: mapped.reduce((a, r) => a + r.gstPaise, 0n),
    totalPaise: mapped.reduce((a, r) => a + r.totalPaise, 0n),
  };
}

/** Sales Register — every client invoice raised in the range. */
export async function getSalesRegister(args: {
  from: string;
  to: string;
  includeReversed?: boolean;
}): Promise<Register> {
  await getActorContext();
  return fetchRegister({
    kind: 'client_invoice',
    taxableCode: '4100',
    gstCode: '2120',
    controlCode: '1200',
    controlSide: 'debit',
    partyTable: 'clients',
    from: args.from,
    to: args.to,
    includeReversed: args.includeReversed ?? false,
  });
}

/** Purchase Register — every vendor bill recorded in the range. */
export async function getPurchaseRegister(args: {
  from: string;
  to: string;
  includeReversed?: boolean;
}): Promise<Register> {
  await getActorContext();
  return fetchRegister({
    kind: 'vendor_bill',
    taxableCode: '5100',
    gstCode: '1250',
    controlCode: '2110',
    controlSide: 'credit',
    partyTable: 'vendors',
    from: args.from,
    to: args.to,
    includeReversed: args.includeReversed ?? false,
  });
}

/* ── Per-Project P&L (all projects) ────────────────────────────────────── */

export type ProjectPnlRow = {
  projectId: string;
  projectName: string;
  clientName: string | null;
  billedPaise: bigint; // revenue invoiced (4100)
  receivedPaise: bigint; // client receipts allocated to this project's invoices
  costedPaise: bigint; // vendor costs billed (5100)
  paidPaise: bigint; // vendor payments allocated to this project's bills
  marginPaise: bigint; // billed − costed (accrual gross margin)
};

export type ProjectPnl = {
  rows: readonly ProjectPnlRow[];
  totalBilledPaise: bigint;
  totalReceivedPaise: bigint;
  totalCostedPaise: bigint;
  totalPaidPaise: bigint;
  totalMarginPaise: bigint;
};

/**
 * Per-project P&L across all projects with activity in the range: revenue
 * billed to the client (4100) and received (receipts allocated to the
 * project's invoices) vs vendor cost billed (5100) and paid (payments
 * allocated to the project's bills). Margin = billed − costed (accrual).
 */
export async function getProjectPnlAll(args: {
  from: string;
  to: string;
  includeReversed?: boolean;
}): Promise<ProjectPnl> {
  await getActorContext();
  const inc = args.includeReversed ?? false;

  const accrual = await db.execute<{ project_id: string; billed: string; costed: string }>(sql`
    SELECT t.project_id::text AS project_id,
      COALESCE(SUM(p.amount_paise) FILTER (WHERE a.code = '4100' AND p.side = 'credit'), 0)::text AS billed,
      COALESCE(SUM(p.amount_paise) FILTER (WHERE a.code = '5100' AND p.side = 'debit'), 0)::text AS costed
    FROM postings p
    JOIN accounts a ON a.id = p.account_id
    JOIN transactions t ON t.id = p.transaction_id
    WHERE t.project_id IS NOT NULL AND a.code IN ('4100', '5100')
      AND t.status = 'posted' AND ${notReversed(inc)}
      AND t.txn_date >= ${args.from}::date AND t.txn_date <= ${args.to}::date
    GROUP BY t.project_id
  `);
  const received = await db.execute<{ project_id: string; received: string }>(sql`
    SELECT inv.project_id::text AS project_id, COALESCE(SUM(ra.amount_paise), 0)::text AS received
    FROM receipt_allocations ra
    JOIN transactions inv ON inv.id = ra.client_invoice_txn_id
    JOIN transactions pay ON pay.id = ra.client_payment_txn_id
    WHERE inv.project_id IS NOT NULL AND pay.status = 'posted' AND ${sql`pay.reverses_id IS NULL`}
      AND pay.txn_date >= ${args.from}::date AND pay.txn_date <= ${args.to}::date
    GROUP BY inv.project_id
  `);
  const paid = await db.execute<{ project_id: string; paid: string }>(sql`
    SELECT bill.project_id::text AS project_id, COALESCE(SUM(ba.amount_paise), 0)::text AS paid
    FROM bill_allocations ba
    JOIN transactions bill ON bill.id = ba.bill_txn_id
    JOIN transactions pay ON pay.id = ba.vendor_payment_txn_id
    WHERE bill.project_id IS NOT NULL AND pay.status = 'posted' AND ${sql`pay.reverses_id IS NULL`}
      AND pay.txn_date >= ${args.from}::date AND pay.txn_date <= ${args.to}::date
    GROUP BY bill.project_id
  `);
  const names = await db.execute<{
    id: string;
    project_name: string;
    client_name: string | null;
  }>(sql`
    SELECT pr.id::text AS id, pr.name AS project_name, c.name AS client_name
    FROM projects pr LEFT JOIN clients c ON c.id = pr.client_id
  `);

  const nameMap = new Map(
    (Array.isArray(names) ? names : []).map((n) => [
      n.id,
      { projectName: n.project_name, clientName: n.client_name },
    ]),
  );
  const acc = new Map<string, { billed: bigint; costed: bigint; received: bigint; paid: bigint }>();
  const ensure = (id: string) => {
    let e = acc.get(id);
    if (!e) {
      e = { billed: 0n, costed: 0n, received: 0n, paid: 0n };
      acc.set(id, e);
    }
    return e;
  };
  for (const r of Array.isArray(accrual) ? accrual : []) {
    const e = ensure(r.project_id);
    e.billed = BigInt(r.billed);
    e.costed = BigInt(r.costed);
  }
  for (const r of Array.isArray(received) ? received : [])
    ensure(r.project_id).received = BigInt(r.received);
  for (const r of Array.isArray(paid) ? paid : []) ensure(r.project_id).paid = BigInt(r.paid);

  const rows = [...acc.entries()]
    .map(([projectId, e]) => ({
      projectId,
      projectName: nameMap.get(projectId)?.projectName ?? 'Unknown project',
      clientName: nameMap.get(projectId)?.clientName ?? null,
      billedPaise: e.billed,
      receivedPaise: e.received,
      costedPaise: e.costed,
      paidPaise: e.paid,
      marginPaise: e.billed - e.costed,
    }))
    .sort((a, b) => (b.billedPaise > a.billedPaise ? 1 : b.billedPaise < a.billedPaise ? -1 : 0));

  return {
    rows,
    totalBilledPaise: rows.reduce((a, r) => a + r.billedPaise, 0n),
    totalReceivedPaise: rows.reduce((a, r) => a + r.receivedPaise, 0n),
    totalCostedPaise: rows.reduce((a, r) => a + r.costedPaise, 0n),
    totalPaidPaise: rows.reduce((a, r) => a + r.paidPaise, 0n),
    totalMarginPaise: rows.reduce((a, r) => a + r.marginPaise, 0n),
  };
}

/* ── TDS Summary ───────────────────────────────────────────────────────── */

export type TdsMonthRow = {
  month: string;
  receivablePaise: bigint; // 1260 — TDS clients withheld from our receipts
  payablePaise: bigint; // 2130 — TDS we withheld from vendor payments
};

export type TdsSummary = {
  rows: readonly TdsMonthRow[];
  totalReceivablePaise: bigint;
  totalPayablePaise: bigint;
};

/**
 * TDS summary by month: TDS receivable (1260 — withheld by clients from money
 * they paid us, a credit we reclaim) vs TDS payable (2130 — withheld by us
 * from vendor payments, owed to the department).
 */
export async function getTdsSummary(args: {
  from: string;
  to: string;
  includeReversed?: boolean;
}): Promise<TdsSummary> {
  await getActorContext();
  const inc = args.includeReversed ?? false;
  const rows = await db.execute<{ month: string; receivable: string; payable: string }>(sql`
    SELECT to_char(date_trunc('month', t.txn_date), 'YYYY-MM') AS month,
      (COALESCE(SUM(p.amount_paise) FILTER (WHERE a.code = '1260' AND p.side = 'debit'), 0)
       - COALESCE(SUM(p.amount_paise) FILTER (WHERE a.code = '1260' AND p.side = 'credit'), 0))::text AS receivable,
      (COALESCE(SUM(p.amount_paise) FILTER (WHERE a.code = '2130' AND p.side = 'credit'), 0)
       - COALESCE(SUM(p.amount_paise) FILTER (WHERE a.code = '2130' AND p.side = 'debit'), 0))::text AS payable
    FROM postings p
    JOIN accounts a ON a.id = p.account_id
    JOIN transactions t ON t.id = p.transaction_id
    WHERE a.code IN ('1260', '2130') AND t.status = 'posted' AND ${notReversed(inc)}
      AND t.txn_date >= ${args.from}::date AND t.txn_date <= ${args.to}::date
    GROUP BY 1
    ORDER BY 1
  `);
  const mapped = (Array.isArray(rows) ? rows : []).map((r) => ({
    month: r.month,
    receivablePaise: BigInt(r.receivable),
    payablePaise: BigInt(r.payable),
  }));
  return {
    rows: mapped,
    totalReceivablePaise: mapped.reduce((a, r) => a + r.receivablePaise, 0n),
    totalPayablePaise: mapped.reduce((a, r) => a + r.payablePaise, 0n),
  };
}
