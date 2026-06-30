'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import { fixedAssets, type FixedAsset } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { createDraftTransaction, postTransaction } from '@/lib/server/ledger/transactions';

const ASSETS_PATH = '/assets';

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; message: string };

function toErr(e: unknown): { ok: false; message: string } {
  if (e instanceof AppError) return { ok: false, message: e.message };
  console.error('[assets/fixed-assets] action error:', e);
  return { ok: false, message: 'Something went wrong. Please try again.' };
}

const norm = (s: string | null | undefined) => {
  const t = (s ?? '').trim();
  return t === '' ? null : t;
};

export type FixedAssetRow = FixedAsset & { bookValuePaise: bigint };

export async function listFixedAssets(): Promise<FixedAssetRow[]> {
  await getActorContext();
  const rows = await db
    .select()
    .from(fixedAssets)
    .where(isNull(fixedAssets.deletedAt))
    .orderBy(asc(fixedAssets.status), asc(fixedAssets.acquisitionDate));
  return rows.map((a) => ({
    ...a,
    bookValuePaise: a.costPaise - a.accumulatedDepreciationPaise,
  }));
}

const AssetInput = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(120).nullish(),
  acquisitionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  costPaise: z.bigint().positive(),
  salvageValuePaise: z.bigint().nonnegative().default(0n),
  usefulLifeMonths: z.number().int().min(1).max(1200),
  sourceBillTxnId: z.string().uuid().nullish(),
  notes: z.string().trim().max(2000).nullish(),
});
export type FixedAssetInputShape = z.input<typeof AssetInput>;

export async function createFixedAsset(
  input: FixedAssetInputShape,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'create_journal_voucher');
    const v = AssetInput.parse(input);
    if (v.salvageValuePaise >= v.costPaise) {
      return { ok: false, message: 'Salvage value must be less than cost.' };
    }
    const [row] = await db
      .insert(fixedAssets)
      .values({
        name: v.name,
        category: norm(v.category),
        acquisitionDate: v.acquisitionDate,
        costPaise: v.costPaise,
        salvageValuePaise: v.salvageValuePaise,
        usefulLifeMonths: v.usefulLifeMonths,
        sourceBillTxnId: norm(v.sourceBillTxnId),
        notes: norm(v.notes),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: fixedAssets.id });
    if (!row) throw new AppError('internal', 'fixed_assets insert returned no row');
    await logAudit({
      actorId: ctx.userId,
      entityType: 'fixed_asset',
      entityId: row.id,
      action: 'insert',
      changes: { name: v.name, cost_paise: v.costPaise.toString() },
    });
    revalidatePath(ASSETS_PATH);
    return { ok: true, data: { id: row.id } };
  } catch (e) {
    return toErr(e);
  }
}

export async function disposeFixedAsset(id: string): Promise<ActionResult> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'create_journal_voucher');
    await db
      .update(fixedAssets)
      .set({ status: 'disposed', updatedBy: ctx.userId })
      .where(eq(fixedAssets.id, id));
    revalidatePath(ASSETS_PATH);
    return { ok: true };
  } catch (e) {
    return toErr(e);
  }
}

/* -------------------------------------------------------------------------- */
/* Depreciation run                                                            */
/* -------------------------------------------------------------------------- */

function monthsBetween(fromIso: string, toIso: string): number {
  const [fy, fm] = fromIso.split('-').map(Number);
  const [ty, tm] = toIso.split('-').map(Number);
  return (ty! - fy!) * 12 + (tm! - fm!);
}

export type DepreciationRunResult = {
  totalPaise: bigint;
  assetsDepreciated: number;
  transactionId: string | null;
};

/**
 * Post straight-line depreciation for all active assets through `throughDate`.
 * One journal: Dr 6500 Depreciation / Cr 1590 Accumulated Depreciation for the
 * period total. Each asset's accumulated depreciation + depreciation_through
 * roll forward; an asset that reaches (cost − salvage) flips to
 * 'fully_depreciated'. Idempotent-ish: re-running with the same date charges
 * nothing more (months elapsed since depreciation_through is 0).
 */
export async function runDepreciation(input: {
  throughDate: string;
}): Promise<ActionResult<DepreciationRunResult>> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'create_journal_voucher');
    const throughDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(input.throughDate);

    const assets = await db
      .select()
      .from(fixedAssets)
      .where(and(isNull(fixedAssets.deletedAt), eq(fixedAssets.status, 'active')));

    const charges: Array<{ id: string; amount: bigint; newAccum: bigint; fully: boolean }> = [];
    let total = 0n;
    for (const a of assets) {
      const depreciable = a.costPaise - a.salvageValuePaise - a.accumulatedDepreciationPaise;
      if (depreciable <= 0n) {
        charges.push({ id: a.id, amount: 0n, newAccum: a.accumulatedDepreciationPaise, fully: true });
        continue;
      }
      const start = a.depreciationThrough ?? a.acquisitionDate;
      const months = monthsBetween(start, throughDate);
      if (months <= 0) continue;
      const monthly = (a.costPaise - a.salvageValuePaise) / BigInt(a.usefulLifeMonths);
      let amount = monthly * BigInt(months);
      if (amount > depreciable) amount = depreciable; // never over-depreciate
      if (amount <= 0n) continue;
      const newAccum = a.accumulatedDepreciationPaise + amount;
      const fully = newAccum >= a.costPaise - a.salvageValuePaise;
      charges.push({ id: a.id, amount, newAccum, fully });
      total += amount;
    }

    let transactionId: string | null = null;
    if (total > 0n) {
      const draft = await createDraftTransaction(ctx, {
        kind: 'journal',
        input: {
          externalRef: `depreciation:${throughDate}:${Date.now()}`,
          txnDate: throughDate,
          journalReason: `Depreciation through ${throughDate}`,
          legs: [
            { accountCode: '6500', side: 'debit', amountPaise: total },
            { accountCode: '1590', side: 'credit', amountPaise: total },
          ],
          isOpeningBalance: false,
          notes: null,
        },
      });
      await postTransaction(ctx, { transactionId: draft.transactionId, acknowledgedFlags: [] });
      transactionId = draft.transactionId;
    }

    // Roll each asset forward (also marks fully-depreciated ones even at 0 charge).
    let depreciated = 0;
    for (const c of charges) {
      if (c.amount > 0n) depreciated += 1;
      await db
        .update(fixedAssets)
        .set({
          accumulatedDepreciationPaise: c.newAccum,
          depreciationThrough: throughDate,
          status: c.fully ? 'fully_depreciated' : 'active',
          updatedBy: ctx.userId,
        })
        .where(eq(fixedAssets.id, c.id));
    }

    revalidatePath(ASSETS_PATH);
    return { ok: true, data: { totalPaise: total, assetsDepreciated: depreciated, transactionId } };
  } catch (e) {
    return toErr(e);
  }
}
