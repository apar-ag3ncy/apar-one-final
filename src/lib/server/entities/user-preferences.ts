'use server';

import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { userPreferences } from '@/lib/db/schema';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

/**
 * Per-user preferences (theme, dock, accent, default landing app, …) stored
 * server-side so they SYNC and are REMEMBERED across sessions / devices /
 * logins. Always scoped to the authenticated user (getActorContext().userId).
 *
 * Shape is an open key/value blob so new settings can be added without a
 * migration; the schema below whitelists + clamps the keys we currently
 * support, and callers coerce with their own defaults.
 */
export type UserPrefs = {
  theme?: 'light' | 'dark';
  dockItemSize?: number;
  dockGap?: number;
  reducedMotion?: boolean;
  accent?: string;
  defaultLandingApp?: string;
};

const ACCENTS = ['#E63A1F', '#7A4E2D', '#5B6677', '#2E8F5A', '#3A5BA0'] as const;

// Whitelist + clamp every key. `.strip()` drops anything not listed, so a
// client can never write arbitrary JSON into a user's row.
const PrefsSchema = z
  .object({
    theme: z.enum(['light', 'dark']),
    dockItemSize: z.coerce.number().int().min(32).max(80),
    dockGap: z.coerce.number().int().min(6).max(32),
    reducedMotion: z.boolean(),
    accent: z.enum(ACCENTS),
    defaultLandingApp: z.string().max(40),
  })
  .partial()
  .strip();

/** The current user's saved preferences ({} if they have none yet). */
export async function getUserPreferences(): Promise<UserPrefs> {
  const ctx = await getActorContext();
  const rows = await db
    .select({ prefs: userPreferences.prefs })
    .from(userPreferences)
    .where(eq(userPreferences.userId, ctx.userId))
    .limit(1);
  // Re-validate on read so a manually-tampered row can't poison the client.
  return PrefsSchema.parse((rows[0]?.prefs as UserPrefs | undefined) ?? {});
}

/**
 * Merge `patch` into the current user's saved preferences (upsert) and return
 * the full merged blob. Partial patches are fine — only the provided keys are
 * overwritten (jsonb `||`), so different settings sections save independently
 * without clobbering each other.
 */
export async function saveUserPreferences(patch: UserPrefs): Promise<UserPrefs> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_user_table_preferences');
  const clean = PrefsSchema.parse(patch);

  const [row] = await db
    .insert(userPreferences)
    .values({
      userId: ctx.userId,
      prefs: clean,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: {
        prefs: sql`${userPreferences.prefs} || ${JSON.stringify(clean)}::jsonb`,
        updatedBy: ctx.userId,
        updatedAt: new Date(),
      },
    })
    .returning({ prefs: userPreferences.prefs });
  return (row?.prefs as UserPrefs | undefined) ?? clean;
}

/** Clear the current user's preferences (revert to defaults on next load). */
export async function resetUserPreferences(): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_user_table_preferences');
  await db.delete(userPreferences).where(eq(userPreferences.userId, ctx.userId));
}
