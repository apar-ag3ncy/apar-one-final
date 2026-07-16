'use server';

// Admin-set global revenue targets, stored in the singleton key/value
// `settings` table. Two keys, both bigint-as-string in `valueText` to match
// the paise-as-text convention (upsertSetting already writes valueText — no
// schema change). Read is open (getActorContext only); write is gated on
// `manage_company_profile`. Mirrors the entities/activity-digest.ts wrapper
// shape: a 'use server' file whose exports add the capability gate over the
// plain settings upsert. Every export stays async (sync exports break the
// Vercel build).

import { db } from '@/lib/db/client';
import { settings } from '@/lib/db/schema/settings';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

const KEY_TARGET_MONTHLY = 'revenue_target_monthly_paise';
const KEY_TARGET_ANNUAL = 'revenue_target_annual_paise';

export type RevenueTargets = {
  /** Monthly net-revenue target in paise (bigint-as-string), or null when unset. */
  monthlyPaise: string | null;
  /** Annual (financial-year) net-revenue target in paise, or null when unset. */
  annualPaise: string | null;
};

/**
 * Read the two global revenue targets. Read-only — any signed-in user can see
 * the targets rendered on the Dashboard, so this only resolves the actor
 * context and does not gate on a capability.
 */
export async function getRevenueTargets(): Promise<RevenueTargets> {
  await getActorContext();
  const rows = await db.select({ key: settings.key, valueText: settings.valueText }).from(settings);
  const byKey = new Map(rows.map((r) => [r.key, r.valueText]));
  return {
    monthlyPaise: byKey.get(KEY_TARGET_MONTHLY) ?? null,
    annualPaise: byKey.get(KEY_TARGET_ANNUAL) ?? null,
  };
}

/** Parse a paise string to a non-negative bigint, throwing a friendly error. */
function parseNonNegativePaise(raw: string, label: string): string {
  let value: bigint;
  try {
    value = BigInt(raw.trim());
  } catch {
    throw new AppError('validation', `${label} must be a whole number of paise.`);
  }
  if (value < 0n) {
    throw new AppError('validation', `${label} cannot be negative.`);
  }
  return value.toString();
}

async function upsertRevenueSetting(
  key: string,
  valueText: string,
  description: string,
  actorId: string,
): Promise<void> {
  await db
    .insert(settings)
    .values({ key, valueText, description, createdBy: actorId, updatedBy: actorId })
    .onConflictDoUpdate({
      target: settings.key,
      set: { valueText, updatedBy: actorId, updatedAt: new Date() },
    });
}

/**
 * Save both revenue targets. Gated on `manage_company_profile` (admin-tier org
 * config). Each input must parse to a non-negative bigint number of paise.
 */
export async function saveRevenueTargets(input: {
  monthlyPaise: string;
  annualPaise: string;
}): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_company_profile');

  const monthly = parseNonNegativePaise(input.monthlyPaise, 'Monthly revenue target');
  const annual = parseNonNegativePaise(input.annualPaise, 'Annual revenue target');

  await upsertRevenueSetting(
    KEY_TARGET_MONTHLY,
    monthly,
    'Company monthly net-revenue target (paise).',
    ctx.userId,
  );
  await upsertRevenueSetting(
    KEY_TARGET_ANNUAL,
    annual,
    'Company annual (financial-year) net-revenue target (paise).',
    ctx.userId,
  );
}
