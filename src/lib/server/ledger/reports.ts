import 'server-only';

import { sql } from 'drizzle-orm';

import { db, type DbClient } from '@/lib/db/client';
import type { Paise } from '@/lib/money';

/**
 * Ledger reports. LEDGER-SPEC §5 + §6. All Postgres-side aggregation
 * (CLAUDE rule #17 — no client-side aggregation > 100 rows).
 *
 * Currency: every paise column returns as `bigint` via postgres-js's
 * native int8 mapping; callers format with `lib/money.formatINR`.
 *
 * Reversed transactions are excluded by default. Pass
 * `includeReversed: true` to include them.
 */

export type ClientPnlRow = {
  clientId: string;
  clientName: string;
  revenuePaise: Paise;
  directCostPaise: Paise;
  grossMarginPaise: Paise;
};

/**
 * **Per-Client P&L** — the headline report. LEDGER-SPEC §5.1.
 *
 * Works because `client_attribution_missing` is enabled (block, default
 * on) — every vendor bill carries an explicit `on_behalf_of_client_id`
 * when attribution='client', and is omitted from cost totals when not.
 */
export async function getPerClientPnL(
  args: { from: string; to: string; includeReversed?: boolean },
  client: DbClient = db,
): Promise<ClientPnlRow[]> {
  const includeReversed = args.includeReversed ?? false;
  const rows = await client.execute<{
    client_id: string;
    client_name: string;
    revenue_paise: string;
    direct_cost_paise: string;
    gross_margin_paise: string;
  }>(sql`
    WITH rev AS (
      SELECT
        t.related_entity_id AS client_id,
        COALESCE(SUM(p.amount_paise), 0) AS total
      FROM postings p
      JOIN transactions t ON t.id = p.transaction_id
      JOIN accounts a ON a.id = p.account_id
      WHERE a.code IN ('4100','4200')
        AND p.side = 'credit'
        AND t.status = 'posted'
        AND ${includeReversed ? sql`true` : sql`t.reverses_id IS NULL`}
        AND t.txn_date BETWEEN ${args.from}::date AND ${args.to}::date
        AND t.related_entity_kind = 'client'
      GROUP BY t.related_entity_id
    ),
    cost AS (
      SELECT
        t.on_behalf_of_client_id AS client_id,
        COALESCE(SUM(p.amount_paise), 0) AS total
      FROM postings p
      JOIN transactions t ON t.id = p.transaction_id
      JOIN accounts a ON a.id = p.account_id
      WHERE a.code IN ('5100','5200')
        AND p.side = 'debit'
        AND t.status = 'posted'
        AND ${includeReversed ? sql`true` : sql`t.reverses_id IS NULL`}
        AND t.on_behalf_of_client_id IS NOT NULL
        AND t.txn_date BETWEEN ${args.from}::date AND ${args.to}::date
      GROUP BY t.on_behalf_of_client_id
    )
    SELECT
      c.id AS client_id,
      c.name AS client_name,
      COALESCE(rev.total, 0) AS revenue_paise,
      COALESCE(cost.total, 0) AS direct_cost_paise,
      COALESCE(rev.total, 0) - COALESCE(cost.total, 0) AS gross_margin_paise
    FROM clients c
    LEFT JOIN rev ON rev.client_id = c.id
    LEFT JOIN cost ON cost.client_id = c.id
    WHERE c.is_archived = false
      AND (rev.total IS NOT NULL OR cost.total IS NOT NULL)
    ORDER BY gross_margin_paise DESC
  `);

  return Array.from(
    rows as Iterable<{
      client_id: string;
      client_name: string;
      revenue_paise: string;
      direct_cost_paise: string;
      gross_margin_paise: string;
    }>,
  ).map((r) => ({
    clientId: r.client_id,
    clientName: r.client_name,
    revenuePaise: BigInt(r.revenue_paise),
    directCostPaise: BigInt(r.direct_cost_paise),
    grossMarginPaise: BigInt(r.gross_margin_paise),
  }));
}

export type TrialBalanceRow = {
  accountCode: string;
  accountName: string;
  accountType: string;
  debitPaise: Paise;
  creditPaise: Paise;
};

/**
 * Trial Balance — every account as-of-date with debit + credit totals.
 * Sums to zero overall (the integrity check on the entire ledger).
 */
export async function getTrialBalance(
  args: { asOfDate: string; includeReversed?: boolean },
  client: DbClient = db,
): Promise<TrialBalanceRow[]> {
  const includeReversed = args.includeReversed ?? false;
  const rows = await client.execute<{
    code: string;
    name: string;
    type: string;
    debit_paise: string;
    credit_paise: string;
  }>(sql`
    SELECT
      a.code,
      a.name,
      a.type::text AS type,
      COALESCE(SUM(p.amount_paise) FILTER (WHERE p.side = 'debit'),  0) AS debit_paise,
      COALESCE(SUM(p.amount_paise) FILTER (WHERE p.side = 'credit'), 0) AS credit_paise
    FROM accounts a
    LEFT JOIN postings p ON p.account_id = a.id
    LEFT JOIN transactions t ON t.id = p.transaction_id
      AND t.status = 'posted'
      AND ${includeReversed ? sql`true` : sql`t.reverses_id IS NULL`}
      AND t.txn_date <= ${args.asOfDate}::date
    WHERE a.is_active = true
    GROUP BY a.code, a.name, a.type
    ORDER BY a.code
  `);

  return Array.from(
    rows as Iterable<{
      code: string;
      name: string;
      type: string;
      debit_paise: string;
      credit_paise: string;
    }>,
  ).map((r) => ({
    accountCode: r.code,
    accountName: r.name,
    accountType: r.type,
    debitPaise: BigInt(r.debit_paise),
    creditPaise: BigInt(r.credit_paise),
  }));
}

export type ArAgingRow = {
  clientId: string;
  clientName: string;
  bucket0to30Paise: Paise;
  bucket31to60Paise: Paise;
  bucket61to90Paise: Paise;
  bucket90PlusPaise: Paise;
  totalOutstandingPaise: Paise;
};

export type ApAgingRow = {
  vendorId: string;
  vendorName: string;
  bucket0to30Paise: Paise;
  bucket31to60Paise: Paise;
  bucket61to90Paise: Paise;
  bucket90PlusPaise: Paise;
  totalOutstandingPaise: Paise;
};

/**
 * AR Aging — outstanding receivables per client by bucket, **aged by invoice
 * due date** (falling back to the document date when no due date is set).
 *
 * Invoice-centric (mirrors AP aging's bill-centric model): each open invoice's
 * outstanding = captured total − receipt allocations − advance allocations.
 * The 0–30 bucket also holds not-yet-due amounts; 31–60 / 61–90 / 90+ are the
 * overdue bands measured from the due date.
 */
export async function getArAging(
  args: { asOfDate: string },
  client: DbClient = db,
): Promise<ArAgingRow[]> {
  const rows = await client.execute<{
    client_id: string;
    client_name: string;
    bucket0to30: string;
    bucket31to60: string;
    bucket61to90: string;
    bucket90plus: string;
    total_outstanding: string;
  }>(sql`
    WITH invoice_balance AS (
      SELECT
        i.client_id,
        (${args.asOfDate}::date - COALESCE(i.due_date, i.document_date))::int AS age_days,
        (
          i.captured_total_paise
          - COALESCE((SELECT SUM(pa.allocated_paise) FROM payment_allocations pa WHERE pa.invoice_id = i.id), 0)
          - COALESCE((SELECT SUM(aa.allocated_paise) FROM advance_allocations aa WHERE aa.invoice_id = i.id), 0)
        )::bigint AS outstanding
      FROM invoices i
      WHERE i.deleted_at IS NULL
        AND i.state IN ('sent', 'partially_paid')
        AND i.document_date <= ${args.asOfDate}::date
    )
    SELECT
      c.id AS client_id,
      c.name AS client_name,
      COALESCE(SUM(outstanding) FILTER (WHERE age_days <= 30), 0)             AS bucket0to30,
      COALESCE(SUM(outstanding) FILTER (WHERE age_days BETWEEN 31 AND 60), 0) AS bucket31to60,
      COALESCE(SUM(outstanding) FILTER (WHERE age_days BETWEEN 61 AND 90), 0) AS bucket61to90,
      COALESCE(SUM(outstanding) FILTER (WHERE age_days > 90), 0)              AS bucket90plus,
      COALESCE(SUM(outstanding), 0)                                          AS total_outstanding
    FROM clients c
    LEFT JOIN invoice_balance b ON b.client_id = c.id
    WHERE c.is_archived = false
    GROUP BY c.id, c.name
    HAVING COALESCE(SUM(outstanding), 0) > 0
    ORDER BY total_outstanding DESC
  `);
  return Array.from(
    rows as Iterable<{
      client_id: string;
      client_name: string;
      bucket0to30: string;
      bucket31to60: string;
      bucket61to90: string;
      bucket90plus: string;
      total_outstanding: string;
    }>,
  ).map((r) => ({
    clientId: r.client_id,
    clientName: r.client_name,
    bucket0to30Paise: BigInt(r.bucket0to30),
    bucket31to60Paise: BigInt(r.bucket31to60),
    bucket61to90Paise: BigInt(r.bucket61to90),
    bucket90PlusPaise: BigInt(r.bucket90plus),
    totalOutstandingPaise: BigInt(r.total_outstanding),
  }));
}

/**
 * AP Aging — outstanding payables per vendor by bucket. Uses
 * `bill_allocations` (Phase 4) to compute settled vs unsettled per
 * vendor_bill, then buckets by the bill's `txn_date`.
 *
 * Convention: positive = we owe the vendor. A vendor_bill posts a
 * credit on `2110 Trade Payables`; vendor_payment_made posts a debit.
 * Aging counts vendor_bill credits minus their allocated portions.
 * Bills with zero outstanding are excluded.
 */
export async function getApAging(
  args: { asOfDate: string },
  client: DbClient = db,
): Promise<ApAgingRow[]> {
  const rows = await client.execute<{
    vendor_id: string;
    vendor_name: string;
    bucket0to30: string;
    bucket31to60: string;
    bucket61to90: string;
    bucket90plus: string;
    total_outstanding: string;
  }>(sql`
    WITH bill_balance AS (
      SELECT
        t.id AS bill_txn_id,
        t.paid_to_vendor_id AS vendor_id,
        (${args.asOfDate}::date - t.txn_date)::int AS age_days,
        (
          COALESCE((
            SELECT SUM(p.amount_paise) FROM postings p
            WHERE p.transaction_id = t.id AND p.side = 'credit'
          ), 0)
          - COALESCE((
            SELECT SUM(amount_paise) FROM bill_allocations
            WHERE bill_txn_id = t.id
          ), 0)
        )::bigint AS outstanding
      FROM transactions t
      WHERE t.kind = 'vendor_bill'
        AND t.status = 'posted'
        AND t.reverses_id IS NULL
        AND t.paid_to_vendor_id IS NOT NULL
        AND t.txn_date <= ${args.asOfDate}::date
    )
    SELECT
      v.id AS vendor_id,
      v.name AS vendor_name,
      COALESCE(SUM(outstanding) FILTER (WHERE age_days BETWEEN 0 AND 30), 0)  AS bucket0to30,
      COALESCE(SUM(outstanding) FILTER (WHERE age_days BETWEEN 31 AND 60), 0) AS bucket31to60,
      COALESCE(SUM(outstanding) FILTER (WHERE age_days BETWEEN 61 AND 90), 0) AS bucket61to90,
      COALESCE(SUM(outstanding) FILTER (WHERE age_days > 90), 0)              AS bucket90plus,
      COALESCE(SUM(outstanding), 0)                                           AS total_outstanding
    FROM vendors v
    LEFT JOIN bill_balance b ON b.vendor_id = v.id
    WHERE v.is_archived = false
    GROUP BY v.id, v.name
    HAVING COALESCE(SUM(outstanding), 0) > 0
    ORDER BY total_outstanding DESC
  `);

  return Array.from(
    rows as Iterable<{
      vendor_id: string;
      vendor_name: string;
      bucket0to30: string;
      bucket31to60: string;
      bucket61to90: string;
      bucket90plus: string;
      total_outstanding: string;
    }>,
  ).map((r) => ({
    vendorId: r.vendor_id,
    vendorName: r.vendor_name,
    bucket0to30Paise: BigInt(r.bucket0to30),
    bucket31to60Paise: BigInt(r.bucket31to60),
    bucket61to90Paise: BigInt(r.bucket61to90),
    bucket90PlusPaise: BigInt(r.bucket90plus),
    totalOutstandingPaise: BigInt(r.total_outstanding),
  }));
}
