'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import {
  recurringInvoiceSchedules,
  type RecurringInvoiceSchedule,
  type RecurringTemplate,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { createDraftInvoice } from '@/lib/server/billing/invoices';

const BILLING_PATH = '/clients';
// The agency's home state (Maharashtra). Intra-state supply ⇒ CGST+SGST, else IGST.
const SUPPLIER_STATE = '27';

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; message: string };

function toErr(e: unknown): { ok: false; message: string } {
  if (e instanceof AppError) return { ok: false, message: e.message };
  console.error('[billing/recurring] action error:', e);
  return { ok: false, message: 'Something went wrong. Please try again.' };
}

const norm = (s: string | null | undefined) => {
  const t = (s ?? '').trim();
  return t === '' ? null : t;
};

const cadenceSchema = z.enum(['weekly', 'monthly', 'quarterly', 'yearly']);

const LineInput = z.object({
  description: z.string().trim().min(1).max(1000),
  sacCode: z.string().trim().max(8).nullish(),
  /** Taxable value (excl. GST) in paise. */
  amountPaise: z.bigint().nonnegative(),
  taxRateBps: z.number().int().min(0).max(10000).default(0),
});

const ScheduleInput = z.object({
  clientId: z.string().uuid(),
  projectId: z.string().uuid().nullish(),
  name: z.string().trim().min(1).max(200),
  cadence: cadenceSchema,
  intervalCount: z.number().int().min(1).max(60).default(1),
  /** First/next run date (when the next invoice is generated). */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  dueDays: z.number().int().min(0).max(365).default(0),
  documentType: z.enum(['invoice', 'proforma']).default('invoice'),
  billToAddressId: z.string().uuid().nullish(),
  placeOfSupply: z
    .string()
    .trim()
    .regex(/^[0-9]{2}$/)
    .nullish(),
  themeId: z.string().uuid().nullish(),
  bankAccountId: z.string().uuid().nullish(),
  terms: z.string().trim().max(4000).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  lines: z.array(LineInput).min(1, 'Add at least one line.'),
});
export type RecurringScheduleInputShape = z.input<typeof ScheduleInput>;

/** Build the stored invoice template (per-line tax + totals + GST split). */
function buildTemplate(v: z.infer<typeof ScheduleInput>): RecurringTemplate {
  let subtotal = 0n;
  let taxTotal = 0n;
  const lines = v.lines.map((l) => {
    const taxable = l.amountPaise;
    const tax = (taxable * BigInt(l.taxRateBps)) / 10000n;
    subtotal += taxable;
    taxTotal += tax;
    return {
      description: l.description,
      sacCode: norm(l.sacCode),
      qty: 1,
      ratePaise: taxable.toString(),
      capturedTaxableValuePaise: taxable.toString(),
      capturedTaxRateBps: l.taxRateBps,
      capturedTaxAmountPaise: tax.toString(),
    };
  });
  const total = subtotal + taxTotal;
  // Intra-state (place of supply == supplier state, or unspecified) ⇒ CGST+SGST.
  const intra = !v.placeOfSupply || v.placeOfSupply === SUPPLIER_STATE;
  const half = taxTotal / 2n;
  const split = intra
    ? { cgst_paise: half.toString(), sgst_paise: (taxTotal - half).toString(), igst_paise: '0', cess_paise: '0' }
    : { cgst_paise: '0', sgst_paise: '0', igst_paise: taxTotal.toString(), cess_paise: '0' };

  return {
    documentType: v.documentType,
    billToAddressId: norm(v.billToAddressId),
    placeOfSupply: norm(v.placeOfSupply),
    themeId: norm(v.themeId),
    bankAccountId: norm(v.bankAccountId),
    terms: norm(v.terms),
    notes: norm(v.notes),
    subtotalPaise: subtotal.toString(),
    capturedTaxTotalPaise: taxTotal.toString(),
    capturedTotalPaise: total.toString(),
    capturedTaxSplit: split,
    lines,
  };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listRecurringSchedules(clientId?: string): Promise<RecurringInvoiceSchedule[]> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_recurring');
  return db
    .select()
    .from(recurringInvoiceSchedules)
    .where(
      and(
        isNull(recurringInvoiceSchedules.deletedAt),
        clientId ? eq(recurringInvoiceSchedules.clientId, clientId) : undefined,
      ),
    )
    .orderBy(desc(recurringInvoiceSchedules.isActive), asc(recurringInvoiceSchedules.nextRunDate));
}

function istToday(): string {
  return new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** How many active schedules are due to generate as of today. */
export async function countDueRecurringSchedules(): Promise<number> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_recurring');
  const today = istToday();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(recurringInvoiceSchedules)
    .where(
      and(
        isNull(recurringInvoiceSchedules.deletedAt),
        eq(recurringInvoiceSchedules.isActive, true),
        lte(recurringInvoiceSchedules.nextRunDate, today),
      ),
    );
  return row?.n ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createRecurringSchedule(
  input: RecurringScheduleInputShape,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'manage_recurring');
    const v = ScheduleInput.parse(input);
    const template = buildTemplate(v);
    const [row] = await db
      .insert(recurringInvoiceSchedules)
      .values({
        clientId: v.clientId,
        projectId: norm(v.projectId),
        name: v.name,
        cadence: v.cadence,
        intervalCount: v.intervalCount,
        nextRunDate: v.startDate,
        endDate: norm(v.endDate),
        dueDays: v.dueDays,
        template,
        isActive: true,
        notes: norm(v.notes),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: recurringInvoiceSchedules.id });
    if (!row) throw new AppError('internal', 'recurring schedule insert returned no row');
    await logAudit({
      actorId: ctx.userId,
      entityType: 'recurring_invoice_schedule',
      entityId: row.id,
      action: 'insert',
      changes: { name: v.name, cadence: v.cadence, client_id: v.clientId },
    });
    revalidatePath(`${BILLING_PATH}/${v.clientId}`);
    return { ok: true, data: { id: row.id } };
  } catch (e) {
    return toErr(e);
  }
}

export async function updateRecurringSchedule(
  id: string,
  input: RecurringScheduleInputShape,
): Promise<ActionResult> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'manage_recurring');
    const v = ScheduleInput.parse(input);
    const template = buildTemplate(v);
    await db
      .update(recurringInvoiceSchedules)
      .set({
        projectId: norm(v.projectId),
        name: v.name,
        cadence: v.cadence,
        intervalCount: v.intervalCount,
        nextRunDate: v.startDate,
        endDate: norm(v.endDate),
        dueDays: v.dueDays,
        template,
        notes: norm(v.notes),
        updatedBy: ctx.userId,
      })
      .where(eq(recurringInvoiceSchedules.id, id));
    revalidatePath(`${BILLING_PATH}/${v.clientId}`);
    return { ok: true };
  } catch (e) {
    return toErr(e);
  }
}

export async function setRecurringScheduleActive(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'manage_recurring');
    await db
      .update(recurringInvoiceSchedules)
      .set({ isActive: active, updatedBy: ctx.userId })
      .where(eq(recurringInvoiceSchedules.id, id));
    revalidatePath(BILLING_PATH);
    return { ok: true };
  } catch (e) {
    return toErr(e);
  }
}

export async function deleteRecurringSchedule(id: string): Promise<ActionResult> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'manage_recurring');
    await db
      .update(recurringInvoiceSchedules)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(recurringInvoiceSchedules.id, id));
    revalidatePath(BILLING_PATH);
    return { ok: true };
  } catch (e) {
    return toErr(e);
  }
}

/* -------------------------------------------------------------------------- */
/* Generation                                                                  */
/* -------------------------------------------------------------------------- */

function addCadence(dateIso: string, cadence: string, interval: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  if (cadence === 'weekly') {
    d.setUTCDate(d.getUTCDate() + 7 * interval);
  } else {
    const months = cadence === 'monthly' ? interval : cadence === 'quarterly' ? 3 * interval : 12 * interval;
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    // Clamp to the new month's length (e.g. 31 Jan + 1 month → 28/29 Feb).
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastDay));
  }
  return d.toISOString().slice(0, 10);
}

function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type GenerateResult = {
  generated: number;
  failed: number;
  results: Array<{ scheduleId: string; name: string; status: 'generated' | 'failed'; invoiceId?: string; error?: string }>;
};

/**
 * Generate the invoices due as of today from every active schedule. Each
 * generated invoice is a DRAFT (the user reviews + sends). Idempotent per
 * schedule+run-date, so re-running won't duplicate. Run by the user via the
 * "Generate due" button (uses their create_invoice capability).
 */
export async function generateDueRecurringInvoices(): Promise<ActionResult<GenerateResult>> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'manage_recurring');
    const today = istToday();
    const due = await db
      .select()
      .from(recurringInvoiceSchedules)
      .where(
        and(
          isNull(recurringInvoiceSchedules.deletedAt),
          eq(recurringInvoiceSchedules.isActive, true),
          lte(recurringInvoiceSchedules.nextRunDate, today),
        ),
      );

    const results: GenerateResult['results'] = [];
    for (const s of due) {
      // Stop once the schedule has run past its end date.
      if (s.endDate && s.nextRunDate > s.endDate) {
        await db
          .update(recurringInvoiceSchedules)
          .set({ isActive: false, updatedBy: ctx.userId })
          .where(eq(recurringInvoiceSchedules.id, s.id));
        continue;
      }
      const t = s.template;
      try {
        const res = await createDraftInvoice({
          clientId: s.clientId,
          projectId: s.projectId,
          documentType: t.documentType,
          billToAddressId: t.billToAddressId,
          documentDate: s.nextRunDate,
          dueDate: s.dueDays > 0 ? addDays(s.nextRunDate, s.dueDays) : null,
          subtotalPaise: BigInt(t.subtotalPaise),
          capturedTaxTotalPaise: BigInt(t.capturedTaxTotalPaise),
          capturedTotalPaise: BigInt(t.capturedTotalPaise),
          placeOfSupply: t.placeOfSupply,
          capturedTaxSplit: {
            cgst_paise: BigInt(t.capturedTaxSplit.cgst_paise),
            sgst_paise: BigInt(t.capturedTaxSplit.sgst_paise),
            igst_paise: BigInt(t.capturedTaxSplit.igst_paise),
            cess_paise: BigInt(t.capturedTaxSplit.cess_paise),
          },
          terms: t.terms,
          notes: t.notes,
          themeId: t.themeId,
          bankAccountId: t.bankAccountId,
          idempotencyKey: `recurring:${s.id}:${s.nextRunDate}`,
          lines: t.lines.map((l, i) => ({
            lineNo: i + 1,
            description: l.description,
            sacCode: l.sacCode,
            qty: l.qty,
            ratePaise: BigInt(l.ratePaise),
            capturedTaxableValuePaise: BigInt(l.capturedTaxableValuePaise),
            capturedTaxRateBps: l.capturedTaxRateBps,
            capturedTaxAmountPaise: BigInt(l.capturedTaxAmountPaise),
          })),
        });
        // Advance to the next run only on success.
        const nextRun = addCadence(s.nextRunDate, s.cadence, s.intervalCount);
        await db
          .update(recurringInvoiceSchedules)
          .set({
            nextRunDate: nextRun,
            lastGeneratedAt: new Date(),
            lastInvoiceId: res.id,
            isActive: s.endDate && nextRun > s.endDate ? false : true,
            updatedBy: ctx.userId,
          })
          .where(eq(recurringInvoiceSchedules.id, s.id));
        results.push({ scheduleId: s.id, name: s.name, status: 'generated', invoiceId: res.id });
      } catch (e) {
        // Leave next_run_date untouched so it can be retried after the cause
        // is fixed (e.g. the client is missing GSTIN/PAN/address).
        results.push({
          scheduleId: s.id,
          name: s.name,
          status: 'failed',
          error: e instanceof AppError ? e.message : 'Could not generate invoice.',
        });
      }
    }
    revalidatePath(BILLING_PATH);
    return {
      ok: true,
      data: {
        generated: results.filter((r) => r.status === 'generated').length,
        failed: results.filter((r) => r.status === 'failed').length,
        results,
      },
    };
  } catch (e) {
    return toErr(e);
  }
}
