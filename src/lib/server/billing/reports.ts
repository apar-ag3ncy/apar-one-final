'use server';

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { arAging, billingKpis, clients } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

/**
 * Billing dashboard + AR-aging readers. Phase 7.
 *
 *   getArAging({asOf, bucketMode, partyId?, limit?, offset?})
 *     - Capability: view_gst_reports OR create_invoice (anyone billing-
 *       facing can pull aging).
 *     - Reads from the ar_aging materialized view (5-min refresh
 *       cadence via the cron in Phase 9 — for now, a manual refresh
 *       happens on demand via refreshBillingViews()).
 *
 *   getBillingDashboard()
 *     - Single-row KPI snapshot from billing_kpis view + a small
 *       per-bucket breakdown derived from ar_aging.
 *
 *   refreshBillingViews()
 *     - Capability: view_gst_reports (manual refresh button on
 *       dashboard). Calls the SECURITY DEFINER refresh_billing_views()
 *       function added in 0026.
 */

const BucketModeSchema = z.enum(['by_due', 'by_invoice']);

const GetArAgingInputSchema = z.object({
  bucketMode: BucketModeSchema.default('by_due'),
  /** Filter to a single client (clients.id). Omit for org-wide. */
  partyId: z.string().uuid().optional(),
  /** Page size; max 1000 because aging is intrinsically bounded. */
  limit: z.number().int().min(1).max(1000).default(500),
  offset: z.number().int().min(0).default(0),
});

export type GetArAgingInput = z.input<typeof GetArAgingInputSchema>;

export type ArAgingResult = {
  rows: Array<{
    invoiceId: string;
    partyEntityId: string;
    partyName: string | null;
    documentNumber: string;
    documentDate: string;
    dueDate: string | null;
    invoiceTotalPaise: bigint;
    outstandingPaise: bigint;
    daysOverdue: number;
    bucket: string;
  }>;
  totalRows: number;
  bucketTotals: Array<{ bucket: string; outstandingPaise: bigint; count: number }>;
};

export async function getArAging(input: GetArAgingInput = {}): Promise<ArAgingResult> {
  const ctx = await getActorContext();
  // Anyone with create_invoice OR view_gst_reports can read aging.
  // Accountants / admins have both; managers have create_invoice.
  if (
    !ctx.capabilities.has('create_invoice') &&
    !ctx.capabilities.has('view_gst_reports') &&
    ctx.role !== 'partner'
  ) {
    throw new AppError(
      'forbidden',
      'AR aging requires create_invoice or view_gst_reports capability.',
    );
  }

  const v = GetArAgingInputSchema.parse(input);
  const bucketCol = v.bucketMode === 'by_due' ? arAging.bucketByDue : arAging.bucketByInvoice;
  const daysCol =
    v.bucketMode === 'by_due' ? arAging.daysOverdueByDue : arAging.daysOverdueByInvoice;

  const conds = [];
  if (v.partyId) conds.push(eq(arAging.partyEntityId, v.partyId));
  const where = conds.length > 0 ? and(...conds) : undefined;

  // Pull rows with client name joined for display.
  const rows = await db
    .select({
      invoiceId: arAging.invoiceId,
      partyEntityId: arAging.partyEntityId,
      partyName: clients.name,
      documentNumber: arAging.documentNumber,
      documentDate: arAging.documentDate,
      dueDate: arAging.dueDate,
      invoiceTotalPaise: arAging.invoiceTotalPaise,
      outstandingPaise: arAging.outstandingPaise,
      daysOverdue: daysCol,
      bucket: bucketCol,
    })
    .from(arAging)
    .leftJoin(clients, eq(clients.id, arAging.partyEntityId))
    .where(where)
    .orderBy(desc(daysCol), asc(arAging.documentDate))
    .limit(v.limit)
    .offset(v.offset);

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(arAging)
    .where(where);

  // Per-bucket totals across the filter (not page-limited).
  const buckets = await db
    .select({
      bucket: bucketCol,
      outstandingPaise: sql<string>`COALESCE(SUM(${arAging.outstandingPaise})::text, '0')`,
      count: sql<number>`count(*)::int`,
    })
    .from(arAging)
    .where(where)
    .groupBy(bucketCol);

  return {
    rows: rows.map((r) => ({
      ...r,
      // outstandingPaise / invoiceTotalPaise come back as bigint from drizzle,
      // but daysCol may be a number. Coerce defensively.
      daysOverdue: Number(r.daysOverdue ?? 0),
    })),
    totalRows: totalRow?.count ?? 0,
    bucketTotals: buckets.map((b) => ({
      bucket: String(b.bucket ?? 'unknown'),
      outstandingPaise: BigInt(b.outstandingPaise ?? '0'),
      count: b.count,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* getBillingDashboard                                                        */
/* -------------------------------------------------------------------------- */

export type BillingDashboardResult = {
  kpis: {
    totalOutstandingPaise: bigint;
    oldestInvoiceDays: number;
    pctIn90PlusBps: number;
    thisMonthInvoicedPaise: bigint;
    thisMonthReceivedPaise: bigint;
    avgDaysToPay90d: number;
    computedAt: string;
  };
  bucketsByDue: Array<{ bucket: string; outstandingPaise: bigint; count: number }>;
  topDebtors: Array<{
    partyEntityId: string;
    partyName: string | null;
    outstandingPaise: bigint;
    oldestDaysOverdue: number;
    invoiceCount: number;
  }>;
};

export async function getBillingDashboard(): Promise<BillingDashboardResult> {
  const ctx = await getActorContext();
  if (
    !ctx.capabilities.has('create_invoice') &&
    !ctx.capabilities.has('view_gst_reports') &&
    ctx.role !== 'partner'
  ) {
    throw new AppError(
      'forbidden',
      'Billing dashboard requires create_invoice or view_gst_reports capability.',
    );
  }

  const [kpis] = await db.select().from(billingKpis).limit(1);
  if (!kpis) {
    throw new AppError(
      'internal',
      'billing_kpis materialized view is empty; run REFRESH MATERIALIZED VIEW billing_kpis (or call refreshBillingViews()).',
    );
  }

  // Per-bucket aging across all clients.
  const buckets = await db
    .select({
      bucket: arAging.bucketByDue,
      outstandingPaise: sql<string>`COALESCE(SUM(${arAging.outstandingPaise})::text, '0')`,
      count: sql<number>`count(*)::int`,
    })
    .from(arAging)
    .groupBy(arAging.bucketByDue);

  // Top 10 debtors by outstanding.
  const topDebtors = await db
    .select({
      partyEntityId: arAging.partyEntityId,
      partyName: clients.name,
      outstandingPaise: sql<string>`COALESCE(SUM(${arAging.outstandingPaise})::text, '0')`,
      oldestDaysOverdue: sql<number>`MAX(${arAging.daysOverdueByDue})::int`,
      invoiceCount: sql<number>`count(*)::int`,
    })
    .from(arAging)
    .leftJoin(clients, eq(clients.id, arAging.partyEntityId))
    .groupBy(arAging.partyEntityId, clients.name)
    .orderBy(sql`SUM(${arAging.outstandingPaise}) DESC NULLS LAST`)
    .limit(10);

  return {
    kpis: {
      totalOutstandingPaise: kpis.totalOutstandingPaise,
      oldestInvoiceDays: kpis.oldestInvoiceDays,
      pctIn90PlusBps: kpis.pctIn90PlusBps,
      thisMonthInvoicedPaise: kpis.thisMonthInvoicedPaise,
      thisMonthReceivedPaise: kpis.thisMonthReceivedPaise,
      avgDaysToPay90d: kpis.avgDaysToPay90d,
      computedAt: kpis.computedAt.toISOString(),
    },
    bucketsByDue: buckets.map((b) => ({
      bucket: String(b.bucket ?? 'unknown'),
      outstandingPaise: BigInt(b.outstandingPaise ?? '0'),
      count: b.count,
    })),
    topDebtors: topDebtors.map((d) => ({
      partyEntityId: d.partyEntityId,
      partyName: d.partyName,
      outstandingPaise: BigInt(d.outstandingPaise ?? '0'),
      oldestDaysOverdue: Number(d.oldestDaysOverdue ?? 0),
      invoiceCount: d.invoiceCount,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* refreshBillingViews — manual refresh trigger                               */
/* -------------------------------------------------------------------------- */

export async function refreshBillingViews(): Promise<{ ok: true; refreshedAt: string }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'view_gst_reports');

  await db.execute(sql`SELECT refresh_billing_views()`);

  return { ok: true, refreshedAt: new Date().toISOString() };
}
