'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { userTablePreferences } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

/**
 * SPEC-AMENDMENT-001 §6.2 — per-user table preferences.
 *
 * Implicit "current" pref: `viewName = null`. Saved named views:
 * `viewName != null`. This file handles the implicit-pref get/save
 * surface used by every DataTable; named-view CRUD comes when we wire
 * the "Save view" toolbar control.
 */

const PrefInputSchema = z.object({
  tableKey: z.string().min(1).max(120),
  visibleColumns: z.array(z.string()).max(64).optional().nullable(),
  filters: z.unknown().optional(),
  sort: z.unknown().optional(),
});

export type TablePreferenceInput = z.infer<typeof PrefInputSchema>;

export type TablePreferenceRow = {
  id: string;
  tableKey: string;
  viewName: string | null;
  visibleColumns: string[] | null;
  filters: unknown;
  sort: unknown;
  isDefault: boolean;
  isShared: boolean;
};

function rowToPref(r: typeof userTablePreferences.$inferSelect): TablePreferenceRow {
  return {
    id: r.id,
    tableKey: r.tableKey,
    viewName: r.viewName,
    visibleColumns: r.visibleColumns,
    filters: r.filters,
    sort: r.sort,
    isDefault: r.isDefault,
    isShared: r.isShared,
  };
}

/** Returns the implicit "current" preference for this user + tableKey, or null. */
export async function getUserTablePreference(tableKey: string): Promise<TablePreferenceRow | null> {
  const ctx = await getActorContext();
  const rows = await db
    .select()
    .from(userTablePreferences)
    .where(
      and(
        eq(userTablePreferences.userId, ctx.userId),
        eq(userTablePreferences.tableKey, tableKey),
        isNull(userTablePreferences.viewName),
        isNull(userTablePreferences.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ? rowToPref(rows[0]) : null;
}

/**
 * Upserts the implicit "current" preference for this (user, tableKey).
 * Partial — pass only the fields you want to change.
 */
export async function saveUserTablePreference(
  input: TablePreferenceInput,
): Promise<TablePreferenceRow> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_user_table_preferences');
  const parsed = PrefInputSchema.parse(input);

  const existing = await db
    .select()
    .from(userTablePreferences)
    .where(
      and(
        eq(userTablePreferences.userId, ctx.userId),
        eq(userTablePreferences.tableKey, parsed.tableKey),
        isNull(userTablePreferences.viewName),
        isNull(userTablePreferences.deletedAt),
      ),
    )
    .limit(1);

  if (existing[0]) {
    const [row] = await db
      .update(userTablePreferences)
      .set({
        visibleColumns:
          parsed.visibleColumns === undefined ? existing[0].visibleColumns : parsed.visibleColumns,
        filters: parsed.filters === undefined ? existing[0].filters : parsed.filters,
        sort: parsed.sort === undefined ? existing[0].sort : parsed.sort,
        updatedBy: ctx.userId,
      })
      .where(eq(userTablePreferences.id, existing[0].id))
      .returning();
    if (!row) throw new AppError('internal', 'pref update returned no row');
    return rowToPref(row);
  }

  const [row] = await db
    .insert(userTablePreferences)
    .values({
      userId: ctx.userId,
      tableKey: parsed.tableKey,
      viewName: null,
      visibleColumns: parsed.visibleColumns ?? null,
      filters: (parsed.filters as object) ?? null,
      sort: (parsed.sort as object) ?? null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning();
  if (!row) throw new AppError('internal', 'pref insert returned no row');
  return rowToPref(row);
}

/** Reset the implicit pref for this user + table (hard delete). */
export async function resetUserTablePreference(tableKey: string): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_user_table_preferences');
  await db
    .delete(userTablePreferences)
    .where(
      and(
        eq(userTablePreferences.userId, ctx.userId),
        eq(userTablePreferences.tableKey, tableKey),
        isNull(userTablePreferences.viewName),
      ),
    );
}
