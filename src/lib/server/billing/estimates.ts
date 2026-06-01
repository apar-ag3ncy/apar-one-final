'use server';

import { and, asc, desc, eq, gte, ilike, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

import { fyStartForDate, todayIstIso } from '@/lib/billing/fy';
import { db, type DbClient } from '@/lib/db/client';
import { estimateLines, estimates } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { logActivity } from '@/lib/activity';
import { logAudit } from '@/lib/audit';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

import { loadBillingSettings, nextDocumentNumber, withNumberingRetry } from './numbering';

/**
 * Estimate (quote) actions. Mirrors invoices.ts + invoice-transitions.ts
 * structurally; the only schema difference is the state enum
 * (draft | sent | accepted | rejected | expired | converted) and the
 * `acceptance_doc_id` link populated by `markEstimateAccepted`
 * (Phase 3.2). Conversion to invoices lives in `convertEstimateToInvoice`
 * (Phase 3.3).
 *
 * Capability `manage_estimate`. No ledger interaction — estimates never
 * post; only invoices that come out of `convertEstimateToInvoice` do.
 */

const StateCodeRe = /^[0-9]{2}$/;
const EstimateIdSchema = z.string().uuid();

const EstimateLineInputSchema = z.object({
  lineNo: z.number().int().positive(),
  serviceItemId: z.string().uuid().nullish(),
  description: z.string().trim().min(1).max(1000),
  sacCode: z
    .string()
    .trim()
    .max(8)
    .nullish()
    .refine((v) => !v || /^[0-9]{4,8}$/.test(v), { message: 'SAC must be 4 to 8 digits.' }),
  qty: z.number().int().positive().default(1),
  ratePaise: z.bigint().nonnegative().default(0n),
  capturedTaxableValuePaise: z.bigint().nonnegative().default(0n),
  capturedTaxRateBps: z.number().int().min(0).max(10000).default(0),
  capturedTaxAmountPaise: z.bigint().nonnegative().default(0n),
  postingAccountCode: z.string().trim().max(20).default('4100'),
});

export type EstimateLineInput = z.input<typeof EstimateLineInputSchema>;

const TaxSplitSchema = z
  .object({
    cgst_paise: z.bigint().nonnegative().optional(),
    sgst_paise: z.bigint().nonnegative().optional(),
    igst_paise: z.bigint().nonnegative().optional(),
    cess_paise: z.bigint().nonnegative().optional(),
  })
  .strict();

const CreateEstimateInputSchema = z.object({
  clientId: z.string().uuid(),
  projectId: z.string().uuid().nullish(),
  documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'documentDate must be YYYY-MM-DD'),
  validTillDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'validTillDate must be YYYY-MM-DD')
    .nullish(),
  subtotalPaise: z.bigint().nonnegative().default(0n),
  capturedTaxTotalPaise: z.bigint().nonnegative().default(0n),
  capturedTotalPaise: z.bigint().nonnegative().default(0n),
  placeOfSupply: z
    .string()
    .trim()
    .nullish()
    .refine((v) => !v || StateCodeRe.test(v), {
      message: 'placeOfSupply must be a 2-digit state code.',
    }),
  capturedTaxSplit: TaxSplitSchema.optional(),
  terms: z.string().trim().max(4000).nullish(),
  notes: z.string().trim().max(4000).nullish(),
  idempotencyKey: z.string().trim().min(8).max(200),
  lines: z.array(EstimateLineInputSchema).min(1, 'Estimate must have at least one line.'),
});

export type CreateEstimateInput = z.input<typeof CreateEstimateInputSchema>;

export type CreateEstimateResult = {
  id: string;
  documentNumber: string;
};

export async function createDraftEstimate(
  input: CreateEstimateInput,
): Promise<CreateEstimateResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_estimate');

  const v = CreateEstimateInputSchema.parse(input);

  const existing = await db
    .select({ id: estimates.id, documentNumber: estimates.documentNumber })
    .from(estimates)
    .where(eq(estimates.idempotencyKey, v.idempotencyKey))
    .limit(1);
  if (existing[0]) return existing[0];

  const settings = await loadBillingSettings();
  const fyStart = fyStartForDate(v.documentDate, settings.fyStartMonth);

  return withNumberingRetry(async () =>
    db.transaction(async (tx) =>
      insertDraftEstimate(tx as unknown as DbClient, ctx.userId, v, fyStart),
    ),
  );
}

async function insertDraftEstimate(
  tx: DbClient,
  userId: string,
  v: z.infer<typeof CreateEstimateInputSchema>,
  fyStart: string,
): Promise<CreateEstimateResult> {
  const { documentNumber } = await nextDocumentNumber('estimate', fyStart, tx);

  const [row] = await tx
    .insert(estimates)
    .values({
      documentNumber,
      documentDate: v.documentDate,
      validTillDate: v.validTillDate ?? null,
      financialYearStart: fyStart,
      clientId: v.clientId,
      projectId: v.projectId ?? null,
      state: 'draft',
      subtotalPaise: v.subtotalPaise,
      capturedTaxTotalPaise: v.capturedTaxTotalPaise,
      capturedTotalPaise: v.capturedTotalPaise,
      placeOfSupply: v.placeOfSupply ?? null,
      capturedTaxSplit: serialiseTaxSplit(v.capturedTaxSplit),
      terms: v.terms ?? null,
      notes: v.notes ?? null,
      idempotencyKey: v.idempotencyKey,
      validationFlags: [],
      createdBy: userId,
      updatedBy: userId,
    })
    .returning({ id: estimates.id });
  if (!row) throw new AppError('internal', 'estimates.insert returned no row');
  const estimateId = row.id;

  await tx.insert(estimateLines).values(
    v.lines.map((l) => ({
      estimateId,
      lineNo: l.lineNo,
      serviceItemId: l.serviceItemId ?? null,
      description: l.description,
      sacCode: l.sacCode ?? null,
      qty: l.qty,
      ratePaise: l.ratePaise,
      capturedTaxableValuePaise: l.capturedTaxableValuePaise,
      capturedTaxRateBps: l.capturedTaxRateBps,
      capturedTaxAmountPaise: l.capturedTaxAmountPaise,
      postingAccountCode: l.postingAccountCode,
      createdBy: userId,
      updatedBy: userId,
    })),
  );

  return { id: estimateId, documentNumber };
}

function serialiseTaxSplit(split: CreateEstimateInput['capturedTaxSplit']): Record<string, string> {
  if (!split) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(split)) {
    if (v !== undefined && v !== null) out[k] = v.toString();
  }
  return out;
}

const UpdateEstimateInputSchema = CreateEstimateInputSchema.partial().omit({
  idempotencyKey: true,
});

export type UpdateEstimateInput = z.input<typeof UpdateEstimateInputSchema>;

export async function updateDraftEstimate(id: string, input: UpdateEstimateInput): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_estimate');
  const estimateId = EstimateIdSchema.parse(id);
  const v = UpdateEstimateInputSchema.parse(input);

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(estimates)
      .where(eq(estimates.id, estimateId))
      .limit(1);
    if (!current) throw new AppError('not_found', `estimate ${estimateId} not found`);
    if (current.state !== 'draft') {
      throw new AppError(
        'validation',
        `estimate ${estimateId} is ${current.state}; only drafts may be updated.`,
      );
    }

    const patch: Partial<typeof estimates.$inferInsert> = { updatedBy: ctx.userId };
    if (v.clientId !== undefined) patch.clientId = v.clientId;
    if (v.projectId !== undefined) patch.projectId = v.projectId ?? null;
    if (v.documentDate !== undefined) {
      patch.documentDate = v.documentDate;
      patch.financialYearStart = fyStartForDate(v.documentDate);
    }
    if (v.validTillDate !== undefined) patch.validTillDate = v.validTillDate ?? null;
    if (v.subtotalPaise !== undefined) patch.subtotalPaise = v.subtotalPaise;
    if (v.capturedTaxTotalPaise !== undefined)
      patch.capturedTaxTotalPaise = v.capturedTaxTotalPaise;
    if (v.capturedTotalPaise !== undefined) patch.capturedTotalPaise = v.capturedTotalPaise;
    if (v.placeOfSupply !== undefined) patch.placeOfSupply = v.placeOfSupply ?? null;
    if (v.capturedTaxSplit !== undefined)
      patch.capturedTaxSplit = serialiseTaxSplit(v.capturedTaxSplit);
    if (v.terms !== undefined) patch.terms = v.terms ?? null;
    if (v.notes !== undefined) patch.notes = v.notes ?? null;

    await tx.update(estimates).set(patch).where(eq(estimates.id, estimateId));

    if (v.lines !== undefined) {
      await tx.delete(estimateLines).where(eq(estimateLines.estimateId, estimateId));
      await tx.insert(estimateLines).values(
        v.lines.map((l) => ({
          estimateId,
          lineNo: l.lineNo,
          serviceItemId: l.serviceItemId ?? null,
          description: l.description,
          sacCode: l.sacCode ?? null,
          qty: l.qty,
          ratePaise: l.ratePaise,
          capturedTaxableValuePaise: l.capturedTaxableValuePaise,
          capturedTaxRateBps: l.capturedTaxRateBps,
          capturedTaxAmountPaise: l.capturedTaxAmountPaise,
          postingAccountCode: l.postingAccountCode,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })),
      );
    }
  });
}

export type EstimateWithLines = {
  estimate: typeof estimates.$inferSelect;
  lines: Array<typeof estimateLines.$inferSelect>;
};

export async function getEstimate(id: string): Promise<EstimateWithLines | null> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_estimate');
  const estimateId = EstimateIdSchema.parse(id);
  const [estimate] = await db.select().from(estimates).where(eq(estimates.id, estimateId)).limit(1);
  if (!estimate) return null;
  const lines = await db
    .select()
    .from(estimateLines)
    .where(eq(estimateLines.estimateId, estimateId))
    .orderBy(asc(estimateLines.lineNo));
  return { estimate, lines };
}

export type ListEstimatesFilters = {
  clientId?: string;
  projectId?: string;
  states?: Array<typeof estimates.$inferSelect.state>;
  documentDateFrom?: string;
  documentDateTo?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

export async function listEstimates(
  filters: ListEstimatesFilters = {},
): Promise<{ rows: Array<typeof estimates.$inferSelect>; total: number }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_estimate');

  const conds = [];
  if (filters.clientId) conds.push(eq(estimates.clientId, filters.clientId));
  if (filters.projectId) conds.push(eq(estimates.projectId, filters.projectId));
  if (filters.states && filters.states.length > 0)
    conds.push(inArray(estimates.state, filters.states));
  if (filters.documentDateFrom) conds.push(gte(estimates.documentDate, filters.documentDateFrom));
  if (filters.documentDateTo) conds.push(lte(estimates.documentDate, filters.documentDateTo));
  if (filters.q && filters.q.trim().length > 0) {
    const q = `%${filters.q.trim()}%`;
    conds.push(ilike(estimates.documentNumber, q));
  }
  const where = conds.length > 0 ? and(...conds) : undefined;

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  const rows = await db
    .select()
    .from(estimates)
    .where(where)
    .orderBy(desc(estimates.documentDate), desc(estimates.documentNumber))
    .limit(limit)
    .offset(offset);

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(estimates)
    .where(where);
  return { rows, total: totalRow?.count ?? 0 };
}

/* -------------------------------------------------------------------------- */
/* State transitions                                                          */
/* -------------------------------------------------------------------------- */

export async function sendEstimate(id: string): Promise<{ id: string; state: 'sent' }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_estimate');
  const estimateId = EstimateIdSchema.parse(id);

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(estimates)
      .where(eq(estimates.id, estimateId))
      .limit(1);
    if (!current) throw new AppError('not_found', `estimate ${estimateId} not found`);
    if (current.state !== 'draft') {
      throw new AppError(
        'validation',
        `estimate ${estimateId} is ${current.state}; only drafts may be sent.`,
      );
    }
    if (current.capturedTotalPaise <= 0n) {
      throw new AppError(
        'validation',
        'Estimate total must be > 0 to send. Add at least one priced line.',
      );
    }

    await tx
      .update(estimates)
      .set({ state: 'sent', sentAt: new Date(), updatedBy: ctx.userId })
      .where(eq(estimates.id, estimateId));

    await logActivity(
      {
        entityType: 'client',
        entityId: current.clientId,
        actorId: ctx.userId,
        kind: 'estimate.sent',
        summary: `Estimate ${current.documentNumber} sent`,
        payload: {
          estimate_id: estimateId,
          document_number: current.documentNumber,
          captured_total_paise: current.capturedTotalPaise.toString(),
        },
      },
      tx as unknown as typeof db,
    );

    await logAudit(
      {
        actorId: ctx.userId,
        entityType: 'estimate',
        entityId: estimateId,
        action: 'update',
        changes: { state: { before: 'draft', after: 'sent' } },
      },
      tx as unknown as typeof db,
    );

    return { id: estimateId, state: 'sent' as const };
  });
}

export async function markEstimateRejected(
  id: string,
  reason: string,
): Promise<{ id: string; state: 'rejected' }> {
  return transitionToTerminal(id, 'rejected', reason, 'estimate.rejected');
}

export async function markEstimateExpired(id: string): Promise<{ id: string; state: 'expired' }> {
  return transitionToTerminal(id, 'expired', null, null);
}

async function transitionToTerminal<N extends 'rejected' | 'expired'>(
  id: string,
  next: N,
  reason: string | null,
  activityKind: 'estimate.rejected' | null,
): Promise<{ id: string; state: N }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_estimate');
  const estimateId = EstimateIdSchema.parse(id);
  if (reason !== null && reason.trim().length < 5) {
    throw new AppError('validation', 'Reason must be at least 5 characters.');
  }

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(estimates)
      .where(eq(estimates.id, estimateId))
      .limit(1);
    if (!current) throw new AppError('not_found', `estimate ${estimateId} not found`);
    if (current.state === next) return;
    if (current.state !== 'sent') {
      throw new AppError(
        'validation',
        `estimate ${estimateId} is ${current.state}; can only ${next === 'expired' ? 'expire' : 'reject'} from 'sent'.`,
      );
    }

    const fields: Partial<typeof estimates.$inferInsert> = {
      state: next,
      updatedBy: ctx.userId,
    };
    if (next === 'rejected') fields.rejectedAt = new Date();
    if (reason && current.notes !== null) fields.notes = `${current.notes}\n[${next}] ${reason}`;
    else if (reason) fields.notes = `[${next}] ${reason}`;

    await tx.update(estimates).set(fields).where(eq(estimates.id, estimateId));

    if (activityKind && current.clientId) {
      await logActivity(
        {
          entityType: 'client',
          entityId: current.clientId,
          actorId: ctx.userId,
          kind: activityKind,
          summary: `Estimate ${current.documentNumber} ${next}`,
          payload: {
            estimate_id: estimateId,
            document_number: current.documentNumber,
            reason,
          },
        },
        tx as unknown as typeof db,
      );
    }
    await logAudit(
      {
        actorId: ctx.userId,
        entityType: 'estimate',
        entityId: estimateId,
        action: 'update',
        changes: { state: { before: current.state, after: next }, ...(reason ? { reason } : {}) },
      },
      tx as unknown as typeof db,
    );
  });

  return { id: estimateId, state: next };
}

/** Composer convenience — today (IST) + fyStart for the New Estimate form. */
export async function getEstimateComposerDefaults(): Promise<{ today: string; fyStart: string }> {
  const settings = await loadBillingSettings();
  const today = todayIstIso();
  return { today, fyStart: fyStartForDate(today, settings.fyStartMonth) };
}
