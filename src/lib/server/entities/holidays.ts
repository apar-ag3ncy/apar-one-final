'use server';

import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';

import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import { companyHolidays } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

/**
 * Company holiday calendar management (Settings → Holidays). Reads/writes
 * require `manage_leaves` (HR-tier). The payroll working-day computation reads
 * `company_holidays` directly, not through here, so it isn't coupled to this
 * capability.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type HolidayRow = { id: string; date: string; name: string };

export type HolidayMutationResult = { ok: true } | { ok: false; message: string };

const CreateHolidaySchema = z.object({
  date: z.string().regex(ISO_DATE, 'Date must be YYYY-MM-DD.'),
  name: z.string().trim().min(1, 'A name is required.').max(120),
});

export async function listHolidays(range?: {
  from?: string;
  to?: string;
}): Promise<readonly HolidayRow[]> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_leaves');

  const conds = [isNull(companyHolidays.deletedAt)];
  if (range?.from && ISO_DATE.test(range.from)) {
    conds.push(gte(companyHolidays.holidayDate, range.from));
  }
  if (range?.to && ISO_DATE.test(range.to)) {
    conds.push(lte(companyHolidays.holidayDate, range.to));
  }

  const rows = await db
    .select({
      id: companyHolidays.id,
      date: companyHolidays.holidayDate,
      name: companyHolidays.name,
    })
    .from(companyHolidays)
    .where(and(...conds))
    .orderBy(asc(companyHolidays.holidayDate));

  return rows.map((r) => ({ id: r.id, date: r.date, name: r.name }));
}

export async function createHoliday(input: {
  date: string;
  name: string;
}): Promise<HolidayMutationResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_leaves');

  const parsed = CreateHolidaySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid holiday.' };
  }
  const { date, name } = parsed.data;

  // Reject a duplicate active date up front for a friendly message (the partial
  // unique index is the final gate).
  const existing = await db
    .select({ id: companyHolidays.id })
    .from(companyHolidays)
    .where(and(eq(companyHolidays.holidayDate, date), isNull(companyHolidays.deletedAt)))
    .limit(1);
  if (existing[0]) {
    return { ok: false, message: `A holiday on ${date} already exists.` };
  }

  try {
    const [row] = await db
      .insert(companyHolidays)
      .values({ holidayDate: date, name, createdBy: ctx.userId, updatedBy: ctx.userId })
      .returning({ id: companyHolidays.id });

    await logAudit({
      actorId: ctx.userId,
      entityType: 'company_holidays',
      entityId: row!.id,
      action: 'insert',
      changes: { holidayDate: date, name },
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    if (e instanceof Error && /duplicate key value/i.test(e.message)) {
      return { ok: false, message: `A holiday on ${date} already exists.` };
    }
    console.error('[holidays] create error:', e);
    return { ok: false, message: 'Could not add the holiday.' };
  }
}

export async function deleteHoliday(id: string): Promise<HolidayMutationResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_leaves');

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, message: 'Invalid holiday id.' };

  const updated = await db
    .update(companyHolidays)
    .set({ deletedAt: new Date(), updatedBy: ctx.userId })
    .where(and(eq(companyHolidays.id, parsed.data), isNull(companyHolidays.deletedAt)))
    .returning({ id: companyHolidays.id, holidayDate: companyHolidays.holidayDate });
  if (updated.length === 0) return { ok: false, message: 'Holiday not found.' };

  await logAudit({
    actorId: ctx.userId,
    entityType: 'company_holidays',
    entityId: parsed.data,
    action: 'delete',
    changes: { holidayDate: updated[0]!.holidayDate },
  });
  return { ok: true };
}
