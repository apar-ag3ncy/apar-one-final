'use server';

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { getActorContext } from '@/lib/server/actor';

/**
 * Vendor statistics — the "how much work do we do with this vendor" rollup
 * for the OS vendor window's Statistics tab (founder change-batch §6).
 *
 * Everything is derived live from existing tables; there is NO stored stats
 * state and NO new columns:
 *
 *   - a "bill" is a posted `vendor_bill` transaction on this vendor
 *     (transactions.paid_to_vendor_id), reversals excluded on both sides
 *     (originals flip to status='reversed', the reversal txn carries
 *     reverses_id) — the same population computeFifoAllocations /
 *     listOpenBillsForVendor (vendor-payments.ts) operate on;
 *   - billed amount = the bill's Trade Payables (2110) credit;
 *   - outstanding per bill = 2110 credit − Σ bill_allocations.amount_paise —
 *     the exact figure the FIFO allocator caps against, so "pending" here
 *     agrees with the payment dialog's open-bill list;
 *   - paid = Σ debits on posted `vendor_payment_made` transactions (the same
 *     debit-sum listVendorPaymentsForVendor shows as the payment amount);
 *   - projects = DISTINCT transactions.project_id across those bills, joined
 *     to `projects` for name + status ('completed' comes from the
 *     project_status enum in schema/projects.ts).
 */

export type VendorProjectStat = {
  projectId: string;
  projectName: string;
  status: 'pitch' | 'won' | 'active' | 'on_hold' | 'completed' | 'cancelled';
};

export type VendorStats = {
  /** Distinct projects carrying at least one posted bill from this vendor. */
  projectsAssigned: number;
  /** Of those, how many are marked completed on the project itself. */
  projectsCompleted: number;
  /** Same population as projectsAssigned (posted bills can't outlive their
   * project — hard delete is dependents-checked), kept as its own field so
   * the "assigned / completed / total" tile reads off the payload directly. */
  projectsTotal: number;
  projects: readonly VendorProjectStat[];
  /** Σ billed (2110 credit) across posted bills. */
  billsTotalPaise: bigint;
  /** Σ posted vendor_payment_made debits. */
  paidTotalPaise: bigint;
  /** Σ per-bill outstanding (billed − allocated), pending bills only. */
  payablePaise: bigint;
  billCount: number;
  /** Bills with outstanding > 0. */
  pendingBillCount: number;
  /** Fully allocated bills. */
  completedBillCount: number;
};

const PROJECT_STATUS_VALUES: ReadonlySet<string> = new Set([
  'pitch',
  'won',
  'active',
  'on_hold',
  'completed',
  'cancelled',
]);

export async function getVendorStats(vendorId: string): Promise<VendorStats> {
  await getActorContext();
  const parsed = z.string().uuid().parse(vendorId);

  // One row per posted bill: billed (2110 credit) + already-allocated paise.
  const billRows = await db.execute<{
    project_id: string | null;
    billed: string;
    allocated: string;
  }>(sql`
    SELECT
      t.project_id::text AS project_id,
      COALESCE((
        SELECT SUM(p.amount_paise) FROM postings p
        JOIN accounts a ON a.id = p.account_id
        WHERE p.transaction_id = t.id AND p.side = 'credit' AND a.code = '2110'
      ), 0)::text AS billed,
      COALESCE((
        SELECT SUM(amount_paise) FROM bill_allocations WHERE bill_txn_id = t.id
      ), 0)::text AS allocated
    FROM transactions t
    WHERE t.kind = 'vendor_bill'
      AND t.status = 'posted'
      AND t.reverses_id IS NULL
      AND t.paid_to_vendor_id = ${parsed}
  `);

  const paidRows = await db.execute<{ total: string }>(sql`
    SELECT COALESCE(SUM(p.amount_paise), 0)::text AS total
    FROM postings p
    JOIN transactions t ON t.id = p.transaction_id
    WHERE t.kind = 'vendor_payment_made'
      AND t.status = 'posted'
      AND t.reverses_id IS NULL
      AND t.paid_to_vendor_id = ${parsed}
      AND p.side = 'debit'
  `);

  const projectRows = await db.execute<{
    project_id: string;
    project_name: string;
    status: string;
  }>(sql`
    SELECT DISTINCT
      pr.id::text AS project_id,
      pr.name AS project_name,
      pr.status::text AS status
    FROM projects pr
    JOIN transactions t ON t.project_id = pr.id
    WHERE t.kind = 'vendor_bill'
      AND t.status = 'posted'
      AND t.reverses_id IS NULL
      AND t.paid_to_vendor_id = ${parsed}
    ORDER BY pr.name ASC
  `);

  let billsTotalPaise = 0n;
  let payablePaise = 0n;
  let billCount = 0;
  let pendingBillCount = 0;
  let completedBillCount = 0;
  for (const r of Array.isArray(billRows) ? billRows : []) {
    const billed = BigInt(r.billed ?? '0');
    const outstanding = billed - BigInt(r.allocated ?? '0');
    billCount += 1;
    billsTotalPaise += billed;
    if (outstanding > 0n) {
      pendingBillCount += 1;
      payablePaise += outstanding;
    } else {
      completedBillCount += 1;
    }
  }

  const paidArr = Array.isArray(paidRows) ? paidRows : [];
  const paidTotalPaise = BigInt(paidArr[0]?.total ?? '0');

  const projects = (Array.isArray(projectRows) ? projectRows : []).map(
    (r): VendorProjectStat => ({
      projectId: r.project_id,
      projectName: r.project_name,
      status: (PROJECT_STATUS_VALUES.has(r.status)
        ? r.status
        : 'active') as VendorProjectStat['status'],
    }),
  );
  const projectsCompleted = projects.filter((p) => p.status === 'completed').length;

  return {
    projectsAssigned: projects.length,
    projectsCompleted,
    projectsTotal: projects.length,
    projects,
    billsTotalPaise,
    paidTotalPaise,
    payablePaise,
    billCount,
    pendingBillCount,
    completedBillCount,
  };
}
