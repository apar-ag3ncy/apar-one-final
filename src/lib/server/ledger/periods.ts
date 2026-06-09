import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { logActivity } from '@/lib/activity';
import { logAudit } from '@/lib/audit';
import { db, type DbClient } from '@/lib/db/client';
import { periods } from '@/lib/db/schema/periods';
import { AppError } from '@/lib/errors';
import { requireCapability, type CurrentUserContext } from '@/lib/rbac';

/**
 * Period management — LEDGER-SPEC §1.3 + SPEC-AMENDMENT period close.
 *
 *   - `listPeriods()` returns every period for an FY (or all FYs) in
 *     calendar order.
 *   - `setPeriodStatus({periodId, next, reason?})` is the single
 *     transition primitive. It enforces:
 *
 *       open         → soft_closed   (cap: close_period)
 *       soft_closed  → closed        (cap: close_period)
 *       soft_closed  → open          (cap: reopen_period, reason required)
 *       closed       → soft_closed   (cap: reopen_period, reason required)
 *
 *     Every write lands an `audit_log` row with the before/after diff
 *     and an `entity_activity_log` event so the periods page can show
 *     a timeline. Reopen reasons land in the audit row's `changes`
 *     blob and on `periods.reopen_reason`.
 *
 *   - Posting enforcement lives in `postTransaction` — see
 *     `transactions.ts:postTransaction`. A `closed` period blocks all
 *     posting; a `soft_closed` period allows posting only when the
 *     actor holds `close_period` (admins/partners who manage the
 *     close).
 */

export type PeriodRow = {
  id: string;
  fiscalYear: number;
  /** 1..12 where 1 = April (Indian FY). */
  month: number;
  startsOn: string;
  endsOn: string;
  status: 'open' | 'soft_closed' | 'closed';
  closedAt: Date | null;
  closedBy: string | null;
  reopenedAt: Date | null;
  reopenedBy: string | null;
  reopenReason: string | null;
};

export async function listPeriods(
  args: { fiscalYear?: number } = {},
  client: DbClient = db,
): Promise<PeriodRow[]> {
  const whereExpr =
    args.fiscalYear !== undefined ? eq(periods.fiscalYear, args.fiscalYear) : undefined;
  const rows = whereExpr
    ? await client
        .select()
        .from(periods)
        .where(whereExpr)
        .orderBy(asc(periods.fiscalYear), asc(periods.month))
    : await client.select().from(periods).orderBy(asc(periods.fiscalYear), asc(periods.month));
  return rows.map((r) => ({
    id: r.id,
    fiscalYear: r.fiscalYear,
    month: r.month,
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    status: r.status,
    closedAt: r.closedAt ?? null,
    closedBy: r.closedBy ?? null,
    reopenedAt: r.reopenedAt ?? null,
    reopenedBy: r.reopenedBy ?? null,
    reopenReason: r.reopenReason ?? null,
  }));
}

type PeriodStatus = 'open' | 'soft_closed' | 'closed';

type Transition =
  | { from: 'open'; to: 'soft_closed' }
  | { from: 'soft_closed'; to: 'closed' }
  | { from: 'soft_closed'; to: 'open' }
  | { from: 'closed'; to: 'soft_closed' };

function validateTransition(from: PeriodStatus, to: PeriodStatus): Transition {
  if (from === 'open' && to === 'soft_closed') return { from, to };
  if (from === 'soft_closed' && to === 'closed') return { from, to };
  if (from === 'soft_closed' && to === 'open') return { from, to };
  if (from === 'closed' && to === 'soft_closed') return { from, to };
  throw new AppError(
    'validation',
    `Invalid period status transition ${from} → ${to}. ` +
      `Open ↔ Soft-Closed ↔ Closed; can't skip steps. To re-open a hard-closed period, ` +
      `transition Closed → Soft-Closed first, then Soft-Closed → Open.`,
  );
}

export async function setPeriodStatus(
  ctx: CurrentUserContext,
  args: { periodId: string; next: PeriodStatus; reason?: string },
  client: DbClient = db,
): Promise<{ id: string; status: PeriodStatus }> {
  const [current] = await client
    .select({
      id: periods.id,
      fiscalYear: periods.fiscalYear,
      month: periods.month,
      status: periods.status,
    })
    .from(periods)
    .where(eq(periods.id, args.periodId))
    .limit(1);
  if (!current) {
    throw new AppError('not_found', `Period ${args.periodId} not found.`);
  }

  if (current.status === args.next) {
    return { id: current.id, status: current.status };
  }

  const transition = validateTransition(current.status, args.next);
  const isReopen =
    transition.to === 'open' || (transition.to === 'soft_closed' && transition.from === 'closed');

  // Capability gate: reopens need `reopen_period`; closes need `close_period`.
  // Both throw via requireCapability — partners pass through.
  requireCapability(ctx, isReopen ? 'reopen_period' : 'close_period');

  if (isReopen && !(args.reason && args.reason.trim().length > 0)) {
    throw new AppError(
      'validation',
      'Reopening a closed period requires a reason. ' +
        `Tried to transition FY${current.fiscalYear}-${String(current.month).padStart(2, '0')} ` +
        `from ${current.status} to ${args.next} without one.`,
    );
  }

  await client.transaction(async (tx) => {
    const now = new Date();
    // `periods` uses the audit-free ledger timestamps mixin — no
    // updated_by column. The actor lands in audit_log + activity_log
    // below instead.
    const patch: Partial<typeof periods.$inferInsert> = { status: args.next };
    if (isReopen) {
      patch.reopenedAt = now;
      patch.reopenedBy = ctx.userId;
      patch.reopenReason = args.reason ?? null;
      // If transitioning all the way back to open, clear the closed
      // markers so a future close lands a fresh closedAt timestamp.
      if (transition.to === 'open') {
        patch.closedAt = null;
        patch.closedBy = null;
      }
    } else {
      patch.closedAt = now;
      patch.closedBy = ctx.userId;
    }
    await tx.update(periods).set(patch).where(eq(periods.id, args.periodId));

    await logAudit(
      {
        actorId: ctx.userId,
        entityType: 'period',
        entityId: args.periodId,
        action: 'update',
        changes: {
          status: { before: current.status, after: args.next },
          ...(isReopen ? { reopen_reason: { before: null, after: args.reason ?? null } } : {}),
        },
      },
      tx as unknown as DbClient,
    );

    await logActivity(
      {
        entityType: 'period',
        entityId: args.periodId,
        actorId: ctx.userId,
        kind: isReopen ? 'period.reopened' : 'period.closed',
        summary: `Period FY${current.fiscalYear}-${String(current.month).padStart(2, '0')} ${current.status} → ${args.next}`,
        payload: {
          from: current.status,
          to: args.next,
          ...(isReopen ? { reason: args.reason } : {}),
        },
      },
      tx as unknown as DbClient,
    );
  });

  return { id: args.periodId, status: args.next };
}
