'use server';

import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { clients, receipts } from '@/lib/db/schema';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

/**
 * TDS receivable register. Phase 8.3.
 *
 * Lists every receipt where the customer deducted TDS from Apār's
 * payment. The aggregate per section is what we claim as a credit
 * against income tax liability when filing the ITR.
 *
 * The CA reconciles this against Form 26AS / AIS downloaded from the
 * income-tax portal (which shows what the customer ACTUALLY reported);
 * mismatches typically mean the customer hasn't filed their TDS
 * return yet.
 */

const TdsReceivableInputSchema = z.object({
  /** FY label like '2025-26'. */
  fyLabel: z.string().regex(/^\d{4}-\d{2}$/),
  /** Optional filter to a single client. */
  clientId: z.string().uuid().optional(),
});

export type TdsReceivableInput = z.input<typeof TdsReceivableInputSchema>;

export type TdsReceivableRow = {
  receiptId: string;
  receiptNumber: string;
  receiptDate: string;
  clientId: string;
  clientName: string | null;
  totalPaise: bigint;
  capturedTdsAmountPaise: bigint;
  capturedTdsSection: string | null;
  capturedTdsRateBps: number;
};

export type TdsReceivableOutput = {
  fyLabel: string;
  rows: TdsReceivableRow[];
  totalsBySection: Array<{
    section: string;
    countReceipts: number;
    totalAmountPaise: bigint;
    totalTdsPaise: bigint;
  }>;
  grandTotalTdsPaise: bigint;
};

export async function tdsReceivableRegister(
  input: TdsReceivableInput,
): Promise<TdsReceivableOutput> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'view_gst_reports');
  const v = TdsReceivableInputSchema.parse(input);

  const fyStartYear = Number(v.fyLabel.slice(0, 4));
  const from = `${fyStartYear}-04-01`;
  const to = `${fyStartYear + 1}-03-31`;

  const conds = [
    gte(receipts.receiptDate, from),
    lte(receipts.receiptDate, to),
    sql`${receipts.capturedTdsAmountPaise} > 0`,
  ];
  if (v.clientId) conds.push(eq(receipts.clientId, v.clientId));

  const rows = await db
    .select({
      receiptId: receipts.id,
      receiptNumber: receipts.receiptNumber,
      receiptDate: receipts.receiptDate,
      clientId: receipts.clientId,
      clientName: clients.name,
      totalPaise: receipts.totalPaise,
      capturedTdsAmountPaise: receipts.capturedTdsAmountPaise,
      capturedTdsSection: receipts.capturedTdsSection,
      capturedTdsRateBps: receipts.capturedTdsRateBps,
    })
    .from(receipts)
    .leftJoin(clients, eq(clients.id, receipts.clientId))
    .where(and(...conds))
    .orderBy(receipts.receiptDate);

  // Aggregate by section.
  const bySection = new Map<
    string,
    { countReceipts: number; totalAmountPaise: bigint; totalTdsPaise: bigint }
  >();
  let grandTotalTdsPaise = 0n;
  for (const r of rows) {
    const sec = r.capturedTdsSection ?? 'unknown';
    const existing = bySection.get(sec) ?? {
      countReceipts: 0,
      totalAmountPaise: 0n,
      totalTdsPaise: 0n,
    };
    existing.countReceipts += 1;
    existing.totalAmountPaise += r.totalPaise;
    existing.totalTdsPaise += r.capturedTdsAmountPaise;
    bySection.set(sec, existing);
    grandTotalTdsPaise += r.capturedTdsAmountPaise;
  }

  return {
    fyLabel: v.fyLabel,
    rows,
    totalsBySection: Array.from(bySection.entries()).map(([section, totals]) => ({
      section,
      ...totals,
    })),
    grandTotalTdsPaise,
  };
}
