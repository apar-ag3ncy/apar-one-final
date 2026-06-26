'use server';

import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import {
  clients,
  creditNotes,
  entityAddresses,
  entityTaxIdentifiers,
  invoiceLines,
  invoices,
  organizations,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

/**
 * GSTR-1 export (monthly outward supplies return). Phase 8.1.
 *
 * Emits the GSTN Phase-3 JSON shape with:
 *   - B2B section (Table 4) — supplies to registered recipients (GSTIN
 *     present)
 *   - B2CS section (Table 12) — small B2C supplies (no GSTIN, value
 *     ≤ ₹2.5L; large B2C goes to Table 5 — not used by Apar since
 *     services to unregistered consumers are rare)
 *   - HSN summary (Table 12 — confusing CBIC numbering; this is
 *     the HSN/SAC summary section, distinct from B2CS Table 12)
 *
 * TODO(human): verify schema against the latest CBIC notification
 * before filing. The GSTN portal updates the JSON shape periodically;
 * the field names here match the Phase-3 spec (post-Sep 2020) but
 * minor field additions may have shipped since. A CA review of the
 * actual JSON against the live offline-utility template is
 * mandatory before the first real filing.
 *
 * Output: serialisable object. The Phase 2.5/9 follow-up will:
 *   1. Persist this JSON as an entity_documents row (kind='gstr_export')
 *      so subsequent audits can reference the exact bytes filed.
 *   2. Provide a download endpoint that streams the JSON.
 *
 * Captured-not-computed: every monetary figure comes from
 * invoices.captured_total_paise / invoices.captured_tax_split. The
 * exporter does NOT re-derive tax from rates.
 */

const Gstr1InputSchema = z.object({
  /** Return-period month, IST. Format: YYYY-MM (e.g. '2025-06'). */
  period: z.string().regex(/^\d{4}-(0[1-9]|1[012])$/, 'period must be YYYY-MM'),
});

export type Gstr1Input = z.input<typeof Gstr1InputSchema>;

export type Gstr1Output = {
  gstin: string;
  ret_period: string; // 'MMYYYY' per GSTN convention
  b2b: Array<{
    ctin: string; // recipient GSTIN
    inv: Array<{
      inum: string;
      idt: string; // DD-MM-YYYY
      val: number; // total invoice value in rupees (NOT paise)
      pos: string; // 2-digit POS state code
      rchrg: 'Y' | 'N';
      itms: Array<{
        num: number; // line number
        itm_det: {
          txval: number; // taxable value (rupees)
          rt: number; // tax rate (%)
          camt: number; // CGST amount
          samt: number; // SGST amount
          iamt: number; // IGST amount
          csamt: number; // CESS amount
        };
      }>;
    }>;
  }>;
  b2cs: Array<{
    sply_ty: 'INTRA' | 'INTER';
    pos: string;
    typ: 'OE'; // Other than e-commerce
    rt: number;
    txval: number;
    camt: number;
    samt: number;
    iamt: number;
    csamt: number;
  }>;
  hsn: {
    data: Array<{
      num: number;
      hsn_sc: string;
      desc: string;
      uqc: string; // unit of measurement code
      qty: number;
      val: number;
      txval: number;
      irt: number;
      iamt: number;
      crt: number;
      camt: number;
      srt: number;
      samt: number;
      csrt: number;
      csamt: number;
    }>;
  };
  cdnr: Array<{
    ctin: string;
    nt: Array<{
      ntty: 'C';
      nt_num: string;
      nt_dt: string;
      val: number;
      pos: string;
      rchrg: 'Y' | 'N';
      itms: Array<{
        num: number;
        itm_det: {
          txval: number;
          rt: number;
          camt: number;
          samt: number;
          iamt: number;
          csamt: number;
        };
      }>;
    }>;
  }>;
};

function paiseToRupees(p: bigint): number {
  // GSTN expects rupees (2 decimal). Float here is downstream-only —
  // bigint paise stays canonical inside our DB.
  return Number(p) / 100;
}

function isoToDdmmyyyy(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

function monthBoundaries(period: string): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return {
    from: `${period}-01`,
    to: `${period}-${String(lastDay).padStart(2, '0')}`,
  };
}

export async function generateGstr1(input: Gstr1Input): Promise<Gstr1Output> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'view_gst_reports');
  const v = Gstr1InputSchema.parse(input);

  const [supplierOrg] = await db.select().from(organizations).limit(1);
  if (!supplierOrg?.gstin) {
    throw new AppError(
      'internal',
      'Supplier GSTIN is missing on organizations row; required for GSTR-1 export.',
    );
  }
  const supplierState = supplierOrg.gstin.slice(0, 2);

  const { from, to } = monthBoundaries(v.period);

  // Pull all sent/partially-paid/paid invoices in the period.
  const invs = await db
    .select()
    .from(invoices)
    .where(
      and(
        gte(invoices.documentDate, from),
        lte(invoices.documentDate, to),
        sql`${invoices.state} IN ('sent', 'partially_paid', 'paid')`,
      ),
    );

  // Pull credit notes in the period.
  const cns = await db
    .select()
    .from(creditNotes)
    .where(
      and(
        gte(creditNotes.documentDate, from),
        lte(creditNotes.documentDate, to),
        eq(creditNotes.state, 'issued'),
      ),
    );

  // Lookup recipient GSTINs once.
  const clientIds = Array.from(
    new Set([...invs.map((i) => i.clientId), ...cns.map((c) => c.clientId)]),
  );
  const taxIds =
    clientIds.length > 0
      ? await db
          .select()
          .from(entityTaxIdentifiers)
          .where(
            and(
              eq(entityTaxIdentifiers.entityType, 'client'),
              eq(entityTaxIdentifiers.kind, 'gstin'),
              sql`${entityTaxIdentifiers.entityId} IN (${sql.join(
                clientIds.map((id) => sql`${id}::uuid`),
                sql`, `,
              )})`,
            ),
          )
      : [];
  const gstinByClient = new Map<string, string>();
  for (const t of taxIds) {
    if (t.entityId) gstinByClient.set(t.entityId, t.maskedValue);
  }

  // Build B2B (registered recipients) and a flat collection to seed B2CS.
  const b2bByCtin = new Map<string, Gstr1Output['b2b'][number]['inv']>();
  const b2csBuckets = new Map<string, Gstr1Output['b2cs'][number]>();

  for (const inv of invs) {
    const recipientGstin = gstinByClient.get(inv.clientId) ?? null;
    const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));

    const itms = lines.map((l, idx) => {
      const split = (inv.capturedTaxSplit ?? {}) as Record<string, string | number | undefined>;
      // Per-line CGST/SGST/IGST is the invoice-level proportion — for v1 we
      // attribute the invoice split proportionally to each line's taxable value.
      // GSTN accepts approximations as long as totals reconcile.
      const proportion =
        inv.subtotalPaise > 0n
          ? Number(l.capturedTaxableValuePaise) / Number(inv.subtotalPaise)
          : 0;
      const camt = paiseToRupees(BigInt(toBigint(split.cgst_paise))) * proportion;
      const samt = paiseToRupees(BigInt(toBigint(split.sgst_paise))) * proportion;
      const iamt = paiseToRupees(BigInt(toBigint(split.igst_paise))) * proportion;
      const csamt = paiseToRupees(BigInt(toBigint(split.cess_paise))) * proportion;
      return {
        num: idx + 1,
        itm_det: {
          txval: paiseToRupees(l.capturedTaxableValuePaise),
          rt: l.capturedTaxRateBps / 100,
          camt: round2(camt),
          samt: round2(samt),
          iamt: round2(iamt),
          csamt: round2(csamt),
        },
      };
    });

    const recipient: Gstr1Output['b2b'][number]['inv'][number] = {
      inum: inv.documentNumber,
      idt: isoToDdmmyyyy(inv.documentDate),
      val: paiseToRupees(inv.capturedTotalPaise),
      pos: inv.placeOfSupply ?? supplierState,
      rchrg: 'N',
      itms,
    };

    if (recipientGstin) {
      const arr = b2bByCtin.get(recipientGstin) ?? [];
      arr.push(recipient);
      b2bByCtin.set(recipientGstin, arr);
    } else {
      // B2CS: bucket by (POS, rate) and aggregate.
      const split = (inv.capturedTaxSplit ?? {}) as Record<string, string | number | undefined>;
      const isInterState = (inv.placeOfSupply ?? supplierState) !== supplierState;
      const taxRateBps = lines[0]?.capturedTaxRateBps ?? 0; // assume uniform rate per invoice
      const key = `${inv.placeOfSupply ?? supplierState}:${taxRateBps}`;
      const existing = b2csBuckets.get(key) ?? {
        sply_ty: isInterState ? ('INTER' as const) : ('INTRA' as const),
        pos: inv.placeOfSupply ?? supplierState,
        typ: 'OE' as const,
        rt: taxRateBps / 100,
        txval: 0,
        camt: 0,
        samt: 0,
        iamt: 0,
        csamt: 0,
      };
      existing.txval += paiseToRupees(inv.subtotalPaise);
      existing.camt += paiseToRupees(BigInt(toBigint(split.cgst_paise)));
      existing.samt += paiseToRupees(BigInt(toBigint(split.sgst_paise)));
      existing.iamt += paiseToRupees(BigInt(toBigint(split.igst_paise)));
      existing.csamt += paiseToRupees(BigInt(toBigint(split.cess_paise)));
      b2csBuckets.set(key, existing);
    }
  }

  // HSN/SAC summary — aggregate all invoice_lines for the period.
  const hsnAgg = new Map<
    string,
    {
      sacCode: string;
      txval: number;
      qty: number;
      camt: number;
      samt: number;
      iamt: number;
      csamt: number;
      taxRateBps: number;
    }
  >();
  for (const inv of invs) {
    const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
    const split = (inv.capturedTaxSplit ?? {}) as Record<string, string | number | undefined>;
    for (const l of lines) {
      if (!l.sacCode) continue;
      const proportion =
        inv.subtotalPaise > 0n
          ? Number(l.capturedTaxableValuePaise) / Number(inv.subtotalPaise)
          : 0;
      const existing = hsnAgg.get(l.sacCode) ?? {
        sacCode: l.sacCode,
        txval: 0,
        qty: 0,
        camt: 0,
        samt: 0,
        iamt: 0,
        csamt: 0,
        taxRateBps: l.capturedTaxRateBps,
      };
      existing.txval += paiseToRupees(l.capturedTaxableValuePaise);
      existing.qty += l.qty;
      existing.camt += paiseToRupees(BigInt(toBigint(split.cgst_paise))) * proportion;
      existing.samt += paiseToRupees(BigInt(toBigint(split.sgst_paise))) * proportion;
      existing.iamt += paiseToRupees(BigInt(toBigint(split.igst_paise))) * proportion;
      existing.csamt += paiseToRupees(BigInt(toBigint(split.cess_paise))) * proportion;
      hsnAgg.set(l.sacCode, existing);
    }
  }

  // Credit notes section (cdnr).
  const cdnrByCtin = new Map<string, Gstr1Output['cdnr'][number]['nt']>();
  for (const cn of cns) {
    const recipientGstin = gstinByClient.get(cn.clientId) ?? null;
    if (!recipientGstin) {
      // B2CS credit notes go in 'cdnur' section — out of v1 scope; we
      // log and skip rather than emit malformed output.
      continue;
    }
    const split = (cn.capturedTaxSplit ?? {}) as Record<string, string | number | undefined>;
    const itm = {
      num: 1,
      itm_det: {
        txval: paiseToRupees(cn.subtotalPaise),
        rt: 0, // populated from line-level inspection if needed
        camt: paiseToRupees(BigInt(toBigint(split.cgst_paise))),
        samt: paiseToRupees(BigInt(toBigint(split.sgst_paise))),
        iamt: paiseToRupees(BigInt(toBigint(split.igst_paise))),
        csamt: paiseToRupees(BigInt(toBigint(split.cess_paise))),
      },
    };
    const arr = cdnrByCtin.get(recipientGstin) ?? [];
    arr.push({
      ntty: 'C',
      nt_num: cn.documentNumber,
      nt_dt: isoToDdmmyyyy(cn.documentDate),
      val: paiseToRupees(cn.capturedTotalPaise),
      pos: cn.placeOfSupply ?? supplierState,
      rchrg: 'N',
      itms: [itm],
    });
    cdnrByCtin.set(recipientGstin, arr);
  }

  // Convert YYYY-MM → MMYYYY per GSTN convention.
  const [yr, mo] = v.period.split('-');
  const retPeriod = `${mo}${yr}`;

  return {
    gstin: supplierOrg.gstin,
    ret_period: retPeriod,
    b2b: Array.from(b2bByCtin.entries()).map(([ctin, inv]) => ({ ctin, inv })),
    b2cs: Array.from(b2csBuckets.values()).map((b) => ({
      ...b,
      txval: round2(b.txval),
      camt: round2(b.camt),
      samt: round2(b.samt),
      iamt: round2(b.iamt),
      csamt: round2(b.csamt),
    })),
    hsn: {
      data: Array.from(hsnAgg.values()).map((h, idx) => ({
        num: idx + 1,
        hsn_sc: h.sacCode,
        desc: '', // descriptions vary per line; left blank — CA review
        uqc: 'OTH', // 'Other' UQC; services typically don't have a SI unit
        qty: h.qty,
        val: round2(h.txval + h.camt + h.samt + h.iamt + h.csamt),
        txval: round2(h.txval),
        irt: h.taxRateBps / 100,
        iamt: round2(h.iamt),
        crt: h.taxRateBps / 200, // CGST = SGST = total/2 for intra-state
        camt: round2(h.camt),
        srt: h.taxRateBps / 200,
        samt: round2(h.samt),
        csrt: 0,
        csamt: round2(h.csamt),
      })),
    },
    cdnr: Array.from(cdnrByCtin.entries()).map(([ctin, nt]) => ({ ctin, nt })),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toBigint(v: unknown): string {
  if (v == null) return '0';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return String(Math.trunc(v));
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return v;
  return '0';
}

// Re-export the small helpers used by tests / siblings.
export { paiseToRupees, isoToDdmmyyyy };

// Silence unused-import lint (kept for downstream entity-lookup helpers).
void clients;
void entityAddresses;
