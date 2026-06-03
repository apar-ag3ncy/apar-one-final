'use server';

import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { accounts, postings, transactions } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

/**
 * GSTR-3B export (monthly self-assessed summary). Phase 8.
 *
 * Unlike GSTR-1 (which lists every outward supply line-by-line),
 * GSTR-3B is a single-page summary the registered taxpayer files
 * declaring totals for the month. The relevant tables we emit:
 *
 *   3.1.a  Outward taxable supplies (other than zero rated, nil
 *          rated and exempted). Taxable value + IGST + CGST + SGST + cess.
 *   3.1.d  Inward supplies liable to reverse charge. Not yet wired
 *          (Phase TBD — bills.is_rcm exists but RCM posting variant doesn't).
 *   4.A.5  Input tax credit from "all other ITC" — i.e. our 1250 GST
 *          Input Credit account's net debit over the period.
 *   4.B    ITC reversed. Not yet wired (depends on advance unwind
 *          tracking beyond the existing 1252 → 2120 flip).
 *   5.1    Interest + Late Fee — captured manually as journal entries
 *          against account 6900 Other OpEx; not auto-aggregated here.
 *
 * Captured-not-computed: every figure comes from posted ledger
 * transactions in the period — output GST from credits on 2120,
 * input credit from debits on 1250. No tax rate re-derivation.
 *
 * TODO(human): verify schema against the latest CBIC notification.
 * GSTN updates the JSON shape periodically; the field names below
 * mirror the offline-utility template at the time of writing.
 */

const Gstr3bInputSchema = z.object({
  /** Return-period month, IST. Format: YYYY-MM (e.g. '2026-04'). */
  period: z.string().regex(/^\d{4}-(0[1-9]|1[012])$/, 'period must be YYYY-MM'),
});

export type Gstr3bInput = z.input<typeof Gstr3bInputSchema>;

export type Gstr3bOutput = {
  gstin: string;
  ret_period: string; // 'MMYYYY' per GSTN convention
  sup_details: {
    /** 3.1.a Outward taxable supplies (regular, non-zero-rated). */
    osup_det: {
      txval: number; // rupees
      iamt: number;
      camt: number;
      samt: number;
      csamt: number;
    };
    /** 3.1.b Outward taxable supplies (zero-rated). */
    osup_zero: { txval: number; iamt: number; csamt: number };
    /** 3.1.c Other outward (nil/exempt/non-GST). */
    osup_nil_exmp: { txval: number };
    /** 3.1.d Inward supplies liable to reverse charge. */
    isup_rev: { txval: number; iamt: number; camt: number; samt: number; csamt: number };
    /** 3.1.e Non-GST outward. */
    osup_nongst: { txval: number };
  };
  itc_elg: {
    /** 4.A All ITC available, broken into sub-rows. */
    itc_avl: Array<{ ty: string; iamt: number; camt: number; samt: number; csamt: number }>;
    /** 4.B ITC reversed. */
    itc_rev: Array<{ ty: string; iamt: number; camt: number; samt: number; csamt: number }>;
    /** 4.C Net ITC (A − B). */
    itc_net: { iamt: number; camt: number; samt: number; csamt: number };
    /** 4.D Ineligible ITC. */
    itc_inelg: Array<{ ty: string; iamt: number; camt: number; samt: number; csamt: number }>;
  };
  /** 5.1 Interest + late fee. v1 not auto-aggregated; returns zeros. */
  intr_ltfee: {
    intr_details: { iamt: number; camt: number; samt: number; csamt: number };
    ltfee_details: { camt: number; samt: number };
  };
};

function paiseToRupees(p: bigint): number {
  return Number(p) / 100;
}

function monthRange(period: string): { from: string; to: string; retPeriod: string } {
  const [year, month] = period.split('-').map(Number) as [number, number];
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const next = new Date(Date.UTC(year, month, 1));
  const to = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const retPeriod = `${String(month).padStart(2, '0')}${year}`;
  return { from, to, retPeriod };
}

async function getOrgGstin(): Promise<string> {
  // We don't have a single canonical org table in Apār — the agency's
  // own GSTIN is captured on the partner-org row. For this v1 export
  // we trust the caller to supply or fall back to a placeholder; the
  // CA review pass replaces this with a real lookup.
  return process.env.APAR_GSTIN ?? 'UNKNOWN_GSTIN';
}

export async function exportGstr3b(input: Gstr3bInput): Promise<Gstr3bOutput> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'view_gst_reports');

  const { period } = Gstr3bInputSchema.parse(input);
  const { from, to, retPeriod } = monthRange(period);

  // ─── 3.1.a — Outward taxable supplies ───────────────────────────
  // We aggregate posted credits on 2120 GST Output Payable for the
  // month, minus credits on 1252 Advance-Output-GST-Asset (those are
  // already booked as deferred output). The taxable base is read
  // from the invoice.captured_tax_split jsonb when available; we
  // approximate by summing credits to 4100/4200 in the same period
  // for txns that touch 2120.
  const outwardRow = await db.execute<{
    txval: string;
    igst: string;
    cgst: string;
    sgst: string;
    cess: string;
  }>(sql`
    WITH gst_txns AS (
      SELECT DISTINCT p.transaction_id
      FROM postings p
      JOIN accounts a ON a.id = p.account_id
      JOIN transactions t ON t.id = p.transaction_id
      WHERE a.code = '2120'
        AND p.side = 'credit'
        AND t.status = 'posted'
        AND t.reverses_id IS NULL
        AND t.txn_date >= ${from}::date
        AND t.txn_date < ${to}::date
        AND t.source_kind <> 'closing'
    )
    SELECT
      COALESCE(SUM(CASE
        WHEN a.code IN ('4100','4200') AND p.side = 'credit' THEN p.amount_paise
        ELSE 0 END), 0)::text AS txval,
      COALESCE(SUM(CASE
        WHEN a.code = '2120' AND p.side = 'credit'
          AND (p.metadata->>'gst_kind' = 'igst' OR p.metadata->>'gst_kind' IS NULL)
          AND (p.metadata->>'cgst_paise' IS NULL)
        THEN p.amount_paise ELSE 0 END), 0)::text AS igst,
      COALESCE(SUM(CASE
        WHEN a.code = '2120' AND p.side = 'credit'
          AND p.metadata->>'gst_kind' = 'cgst'
        THEN p.amount_paise ELSE 0 END), 0)::text AS cgst,
      COALESCE(SUM(CASE
        WHEN a.code = '2120' AND p.side = 'credit'
          AND p.metadata->>'gst_kind' = 'sgst'
        THEN p.amount_paise ELSE 0 END), 0)::text AS sgst,
      0::text AS cess
    FROM postings p
    JOIN accounts a ON a.id = p.account_id
    WHERE p.transaction_id IN (SELECT transaction_id FROM gst_txns)
  `);
  const outward = Array.isArray(outwardRow) ? (outwardRow[0] ?? null) : null;

  // ─── 4.A.5 — Net ITC for the month ───────────────────────────────
  // Net debit on 1250 GST Input Credit minus any credits (reversals).
  const itcRow = await db.execute<{ net_paise: string }>(sql`
    SELECT
      COALESCE(SUM(CASE
        WHEN p.side = 'debit' THEN p.amount_paise
        WHEN p.side = 'credit' THEN -p.amount_paise
      END), 0)::text AS net_paise
    FROM postings p
    JOIN accounts a ON a.id = p.account_id
    JOIN transactions t ON t.id = p.transaction_id
    WHERE a.code = '1250'
      AND t.status = 'posted'
      AND t.reverses_id IS NULL
      AND t.txn_date >= ${from}::date
      AND t.txn_date < ${to}::date
  `);
  const itcNetPaise = BigInt((Array.isArray(itcRow) ? itcRow[0]?.net_paise : '0') ?? '0');

  void accounts;
  void transactions;
  void postings;
  void and;
  void eq;
  void gte;
  void lt;

  const out: Gstr3bOutput = {
    gstin: await getOrgGstin(),
    ret_period: retPeriod,
    sup_details: {
      osup_det: {
        txval: paiseToRupees(BigInt(outward?.txval ?? '0')),
        iamt: paiseToRupees(BigInt(outward?.igst ?? '0')),
        camt: paiseToRupees(BigInt(outward?.cgst ?? '0')),
        samt: paiseToRupees(BigInt(outward?.sgst ?? '0')),
        csamt: paiseToRupees(BigInt(outward?.cess ?? '0')),
      },
      osup_zero: { txval: 0, iamt: 0, csamt: 0 },
      osup_nil_exmp: { txval: 0 },
      isup_rev: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
      osup_nongst: { txval: 0 },
    },
    itc_elg: {
      itc_avl: [
        {
          ty: 'OTH',
          iamt: paiseToRupees(itcNetPaise),
          camt: 0,
          samt: 0,
          csamt: 0,
        },
      ],
      itc_rev: [],
      itc_net: {
        iamt: paiseToRupees(itcNetPaise),
        camt: 0,
        samt: 0,
        csamt: 0,
      },
      itc_inelg: [],
    },
    intr_ltfee: {
      intr_details: { iamt: 0, camt: 0, samt: 0, csamt: 0 },
      ltfee_details: { camt: 0, samt: 0 },
    },
  };

  if (out.gstin === 'UNKNOWN_GSTIN') {
    throw new AppError(
      'validation',
      'APAR_GSTIN env var not set — GSTR-3B export needs the agency GSTIN before any filing.',
    );
  }

  return out;
}
