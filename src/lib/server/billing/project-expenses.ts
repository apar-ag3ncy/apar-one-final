'use server';

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { getActorContext } from '@/lib/server/actor';

/**
 * Per-vendor expense rollup for a single project — the project window's
 * "Expenses" tab. Money spent on a project through its vendors, grouped by
 * vendor. Two sources, both read live from the ledger / capture tables:
 *
 *   • Vendor bills (ledger `vendor_bill` transactions with a project_id) —
 *     billed = the 2110 Trade Payables credit; paid = allocations against the
 *     bill; outstanding = billed − paid. Same source as getVendorPayablesByProject.
 *   • Office expenses booked to the project (office_expenses.project_id) — direct
 *     spend that's already paid (Dr expense / Cr cash), so it has no outstanding.
 *
 * `totalSpendPaise` = paid vendor bills + office spend (money actually out to
 * that vendor for the project). Returns paise as strings (RSC-safe).
 */

function rowsOf<T>(result: unknown): T[] {
  return Array.isArray(result) ? (result as T[]) : [];
}

export type ProjectVendorExpenseRow = {
  vendorId: string | null;
  vendorName: string;
  /** Committed via vendor bills (2110 payable). */
  billedPaise: string;
  /** Paid against those vendor bills (allocations). */
  paidPaise: string;
  /** billed − paid. */
  outstandingPaise: string;
  /** Direct office expenses booked to the project for this vendor (already paid). */
  officeSpendPaise: string;
  /** Money actually spent on this vendor for the project = paid + office spend. */
  totalSpendPaise: string;
  billCount: number;
  officeCount: number;
};

export type ProjectVendorExpenses = {
  rows: ProjectVendorExpenseRow[];
  totalBilledPaise: string;
  totalPaidPaise: string;
  totalOutstandingPaise: string;
  totalOfficeSpendPaise: string;
  totalSpendPaise: string;
};

export async function getProjectVendorExpenses(projectId: string): Promise<ProjectVendorExpenses> {
  await getActorContext();
  const pid = z.string().uuid().parse(projectId);

  // 1) Ledger vendor bills for this project, grouped by vendor.
  const billRows = await db.execute<{
    vendor_id: string;
    vendor_name: string | null;
    bill_count: string;
    billed: string;
    paid: string;
  }>(sql`
    WITH bills AS (
      SELECT
        t.id,
        t.paid_to_vendor_id AS vendor_id,
        COALESCE((
          SELECT SUM(p.amount_paise) FROM postings p
          JOIN accounts a ON a.id = p.account_id
          WHERE p.transaction_id = t.id AND p.side = 'credit' AND a.code = '2110'
        ), 0) AS billed,
        COALESCE((SELECT SUM(amount_paise) FROM bill_allocations WHERE bill_txn_id = t.id), 0) AS paid
      FROM transactions t
      WHERE t.kind = 'vendor_bill'
        -- Include drafts (pending bills) + posted; only reversed bills drop out,
        -- so the founder sees every recorded vendor expense on the project.
        AND t.status <> 'reversed'
        AND t.reverses_id IS NULL
        AND t.project_id = ${pid}
        AND t.paid_to_vendor_id IS NOT NULL
    )
    SELECT
      b.vendor_id::text AS vendor_id,
      v.name AS vendor_name,
      COUNT(*)::text AS bill_count,
      COALESCE(SUM(b.billed), 0)::text AS billed,
      COALESCE(SUM(b.paid), 0)::text AS paid
    FROM bills b
    LEFT JOIN vendors v ON v.id = b.vendor_id
    GROUP BY b.vendor_id, v.name
  `);

  // 2) Office expenses booked to this project, grouped by vendor (linked or free-text).
  const officeRows = await db.execute<{
    vendor_id: string | null;
    vendor_name: string;
    office_count: string;
    spend: string;
  }>(sql`
    SELECT
      oe.vendor_id::text AS vendor_id,
      COALESCE(v.name, NULLIF(TRIM(oe.vendor_name), ''), 'Unspecified vendor') AS vendor_name,
      COUNT(*)::text AS office_count,
      COALESCE(SUM(oe.amount_paise + COALESCE(oe.gst_paise, 0)), 0)::text AS spend
    FROM office_expenses oe
    LEFT JOIN vendors v ON v.id = oe.vendor_id
    WHERE oe.project_id = ${pid} AND oe.deleted_at IS NULL
    GROUP BY oe.vendor_id, COALESCE(v.name, NULLIF(TRIM(oe.vendor_name), ''), 'Unspecified vendor')
  `);

  const keyOf = (vid: string | null, name: string) => (vid ? 'v:' + vid : 'n:' + name);
  const map = new Map<string, ProjectVendorExpenseRow>();

  for (const b of rowsOf<{
    vendor_id: string;
    vendor_name: string | null;
    bill_count: string;
    billed: string;
    paid: string;
  }>(billRows)) {
    const name = b.vendor_name ?? 'Vendor';
    map.set(keyOf(b.vendor_id, name), {
      vendorId: b.vendor_id,
      vendorName: name,
      billedPaise: b.billed,
      paidPaise: b.paid,
      outstandingPaise: (BigInt(b.billed) - BigInt(b.paid)).toString(),
      officeSpendPaise: '0',
      totalSpendPaise: b.paid,
      billCount: Number(b.bill_count),
      officeCount: 0,
    });
  }

  for (const o of rowsOf<{
    vendor_id: string | null;
    vendor_name: string;
    office_count: string;
    spend: string;
  }>(officeRows)) {
    const k = keyOf(o.vendor_id, o.vendor_name);
    const cur = map.get(k);
    if (cur) {
      cur.officeSpendPaise = o.spend;
      cur.officeCount = Number(o.office_count);
      cur.totalSpendPaise = (BigInt(cur.paidPaise) + BigInt(o.spend)).toString();
    } else {
      map.set(k, {
        vendorId: o.vendor_id,
        vendorName: o.vendor_name,
        billedPaise: '0',
        paidPaise: '0',
        outstandingPaise: '0',
        officeSpendPaise: o.spend,
        totalSpendPaise: o.spend,
        billCount: 0,
        officeCount: Number(o.office_count),
      });
    }
  }

  const rows = [...map.values()].sort((a, b) =>
    BigInt(b.totalSpendPaise) > BigInt(a.totalSpendPaise)
      ? 1
      : BigInt(b.totalSpendPaise) < BigInt(a.totalSpendPaise)
        ? -1
        : 0,
  );
  const sum = (pick: (r: ProjectVendorExpenseRow) => string) =>
    rows.reduce((s, r) => s + BigInt(pick(r)), 0n).toString();

  return {
    rows,
    totalBilledPaise: sum((r) => r.billedPaise),
    totalPaidPaise: sum((r) => r.paidPaise),
    totalOutstandingPaise: sum((r) => r.outstandingPaise),
    totalOfficeSpendPaise: sum((r) => r.officeSpendPaise),
    totalSpendPaise: sum((r) => r.totalSpendPaise),
  };
}
