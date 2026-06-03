'use server';

import { sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { getActorContext } from '@/lib/server/actor';

/**
 * Vendor × TDS section × FY cumulative — backs the
 * `tds_threshold_crossed` validation rule (Phase 7) and the TDS
 * "headroom" lookup used by the vendor-bill form.
 *
 * Indian FY: April → March. `fiscal_year = year + 1` if month ≥ 4.
 *
 * The view `vw_tds_vendor_fy_cumulative` is defined in
 * `drizzle/0033_tds_gst_validation_enable.sql`. It aggregates over
 * `bills` rows in state recorded / partially_paid / paid (i.e. real
 * obligations, not drafts or voids).
 */

export type TdsCumulative = {
  vendorId: string;
  section: string;
  fiscalYear: number;
  cumulativeBasePaise: bigint;
  cumulativeTdsPaise: bigint;
  billCount: number;
};

export async function getTdsCumulativeFor(args: {
  vendorId: string;
  section: string;
  fiscalYear: number;
}): Promise<TdsCumulative> {
  await getActorContext();
  const rows = await db.execute<{
    vendor_id: string;
    section: string;
    fiscal_year: number;
    cumulative_base_paise: string;
    cumulative_tds_paise: string;
    bill_count: number;
  }>(sql`
    SELECT vendor_id, section, fiscal_year,
           cumulative_base_paise::text, cumulative_tds_paise::text, bill_count
    FROM vw_tds_vendor_fy_cumulative
    WHERE vendor_id = ${args.vendorId}
      AND section = ${args.section}
      AND fiscal_year = ${args.fiscalYear}
  `);
  const r = Array.isArray(rows) ? rows[0] : undefined;
  return {
    vendorId: args.vendorId,
    section: args.section,
    fiscalYear: args.fiscalYear,
    cumulativeBasePaise: BigInt(r?.cumulative_base_paise ?? '0'),
    cumulativeTdsPaise: BigInt(r?.cumulative_tds_paise ?? '0'),
    billCount: r?.bill_count ?? 0,
  };
}

export async function listTdsCumulativeForVendor(args: {
  vendorId: string;
  fiscalYear?: number;
}): Promise<TdsCumulative[]> {
  await getActorContext();
  const fyClause = args.fiscalYear ? sql`AND fiscal_year = ${args.fiscalYear}` : sql``;
  const rows = await db.execute<{
    vendor_id: string;
    section: string;
    fiscal_year: number;
    cumulative_base_paise: string;
    cumulative_tds_paise: string;
    bill_count: number;
  }>(sql`
    SELECT vendor_id, section, fiscal_year,
           cumulative_base_paise::text, cumulative_tds_paise::text, bill_count
    FROM vw_tds_vendor_fy_cumulative
    WHERE vendor_id = ${args.vendorId}
    ${fyClause}
    ORDER BY fiscal_year DESC, section ASC
  `);
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    vendorId: r.vendor_id,
    section: r.section,
    fiscalYear: r.fiscal_year,
    cumulativeBasePaise: BigInt(r.cumulative_base_paise),
    cumulativeTdsPaise: BigInt(r.cumulative_tds_paise),
    billCount: r.bill_count,
  }));
}
