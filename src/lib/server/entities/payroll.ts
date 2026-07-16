'use server';

import { and, asc, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logActivity } from '@/lib/activity';
import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import {
  bankAccounts,
  bonusesAndPerks,
  employees,
  leaves,
  reimbursements,
  salaryPayments,
  salaryStructures,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import {
  createDraftTransaction,
  postTransaction,
  reverseTransaction,
} from '@/lib/server/ledger/transactions';

/**
 * Payroll capture surfaces — SPEC-AMENDMENT-001 §9. Apar never computes
 * payroll tax (no GST/TDS math on rates); these endpoints take amounts
 * AS ENTERED and persist them. Ledger orchestration (post a salary run
 * → fan into transactions) is deliberately NOT in this file — that lives
 * in `lib/server/ledger/` once the salary_disbursement / bonus_payment
 * posting templates ship.
 *
 * Available here:
 *   - recordBonusOrPerk
 *   - submitReimbursement / approveReimbursement
 *   - applyLeave / approveLeave
 *   - readers: listEmployeeBonuses / listEmployeeReimbursements /
 *     listEmployeeLeaves / listEmployeeSalaryStructures
 *
 * Missing (per BACKEND-STATE §8):
 *   - generateSalaryRun / postSalaryRun / reverseSalaryRun
 *   - payReimbursement (creates a ledger transaction)
 */

/** The calendar day before an ISO `YYYY-MM-DD` date, computed in UTC so no
 * timezone shift can nudge it across a day boundary. */
function dayBeforeIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** "₹35,000" from a paise bigint — for human-readable activity summaries. */
function inr(paise: bigint | null): string {
  if (paise == null) return 'in-kind';
  return `₹${(Number(paise) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

const BonusKindEnum = z.enum(['bonus', 'perk_cash', 'perk_inkind', 'gift', 'award']);
const ReimbursementAttributionEnum = z.enum(['client', 'opex']);
const ReimbursementStatusEnum = z.enum(['submitted', 'approved', 'rejected', 'paid']);
const LeaveKindEnum = z.enum([
  'earned',
  'casual',
  'sick',
  'unpaid',
  'comp_off',
  'maternity',
  'paternity',
]);
const LeaveStatusEnum = z.enum(['applied', 'approved', 'rejected', 'cancelled']);

/* -------------------------------------------------------------------------- */
/* Bonuses & Perks                                                             */
/* -------------------------------------------------------------------------- */

const RecordBonusSchema = z.object({
  employeeId: z.string().uuid(),
  kind: BonusKindEnum,
  bonusDate: z.string(), // ISO date
  amountPaise: z.bigint().nullable(),
  description: z.string().min(1),
  sourceDocumentId: z.string().uuid().nullable().optional(),
  taxable: z.enum(['taxable', 'not_taxable', 'captured']).default('captured'),
});

export type RecordBonusInput = z.infer<typeof RecordBonusSchema>;

export async function recordBonusOrPerk(input: RecordBonusInput): Promise<{ id: string }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'record_bonus_or_perk');
  const parsed = RecordBonusSchema.parse(input);

  // Captured-not-computed gate: in-kind bonuses may carry null amount; cash
  // ones must carry a positive bigint amount.
  if (parsed.kind !== 'perk_inkind' && (parsed.amountPaise === null || parsed.amountPaise <= 0n)) {
    throw new AppError(
      'validation',
      'Cash bonus / perk / gift / award requires a positive amount in paise.',
    );
  }

  const [row] = await db
    .insert(bonusesAndPerks)
    .values({
      employeeId: parsed.employeeId,
      kind: parsed.kind,
      bonusDate: parsed.bonusDate,
      amountPaise: parsed.amountPaise,
      description: parsed.description,
      sourceDocumentId: parsed.sourceDocumentId ?? null,
      taxable: parsed.taxable,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning({ id: bonusesAndPerks.id });
  if (!row) throw new AppError('internal', 'bonuses_and_perks insert returned no row');
  return { id: row.id };
}

export type BonusRow = {
  id: string;
  kind: 'bonus' | 'perk_cash' | 'perk_inkind' | 'gift' | 'award';
  bonusDate: string;
  amountPaise: bigint | null;
  description: string;
  taxable: string;
};

export async function listEmployeeBonuses(employeeId: string): Promise<readonly BonusRow[]> {
  await getActorContext();
  const rows = await db
    .select({
      id: bonusesAndPerks.id,
      kind: bonusesAndPerks.kind,
      bonusDate: bonusesAndPerks.bonusDate,
      amountPaise: bonusesAndPerks.amountPaise,
      description: bonusesAndPerks.description,
      taxable: bonusesAndPerks.taxable,
    })
    .from(bonusesAndPerks)
    .where(and(eq(bonusesAndPerks.employeeId, employeeId), isNull(bonusesAndPerks.deletedAt)))
    .orderBy(desc(bonusesAndPerks.bonusDate))
    .limit(50);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    bonusDate: r.bonusDate,
    amountPaise: r.amountPaise,
    description: r.description,
    taxable: r.taxable,
  }));
}

/**
 * Delete a bonus / perk into the Trash. Bonuses don't post to the ledger yet;
 * if one ever carries a transaction link it is reversed first.
 */
export async function deleteBonusOrPerk(input: { id: string }): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'record_bonus_or_perk');
  const parsed = z.object({ id: z.string().uuid() }).parse(input);

  const [row] = await db
    .select()
    .from(bonusesAndPerks)
    .where(and(eq(bonusesAndPerks.id, parsed.id), isNull(bonusesAndPerks.deletedAt)))
    .limit(1);
  if (!row) throw new AppError('not_found', 'Bonus not found.');

  if (row.transactionId) {
    requireCapability(ctx, 'reverse_transaction');
    await reverseTransaction(ctx, {
      transactionId: row.transactionId,
      reason: `Bonus deleted — ${row.description}`.slice(0, 200),
    });
  }
  await db
    .update(bonusesAndPerks)
    // Null the link if we reversed it — a restored bonus must not point at a
    // reversed transaction as if it were still in force.
    .set({ deletedAt: new Date(), transactionId: null, updatedBy: ctx.userId })
    .where(eq(bonusesAndPerks.id, row.id));

  await logAudit({
    actorId: ctx.userId,
    entityType: 'bonus',
    entityId: row.id,
    action: 'delete',
    changes: { soft_delete: true, kind: row.kind, description: row.description },
  });
  await logActivity({
    entityType: 'employee',
    entityId: row.employeeId,
    actorId: ctx.userId,
    kind: 'bonus.deleted',
    summary: `${row.kind === 'bonus' ? 'Bonus' : 'Perk'} "${row.description}" (${inr(row.amountPaise)}) moved to Trash`,
  });
}

/** Restore a trashed bonus / perk (capture row only — bonuses don't post yet). */
export async function restoreBonusOrPerk(input: { id: string }): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'record_bonus_or_perk');
  const parsed = z.object({ id: z.string().uuid() }).parse(input);

  const [row] = await db
    .select()
    .from(bonusesAndPerks)
    .where(and(eq(bonusesAndPerks.id, parsed.id), isNotNull(bonusesAndPerks.deletedAt)))
    .limit(1);
  if (!row) throw new AppError('not_found', 'Bonus not found in the Trash.');

  await db
    .update(bonusesAndPerks)
    .set({ deletedAt: null, updatedBy: ctx.userId })
    .where(eq(bonusesAndPerks.id, row.id));

  await logAudit({
    actorId: ctx.userId,
    entityType: 'bonus',
    entityId: row.id,
    action: 'update',
    changes: { restore: true },
  });
  await logActivity({
    entityType: 'employee',
    entityId: row.employeeId,
    actorId: ctx.userId,
    kind: 'bonus.restored',
    summary: `${row.kind === 'bonus' ? 'Bonus' : 'Perk'} "${row.description}" (${inr(row.amountPaise)}) restored from Trash`,
  });
}

/** Hard-delete a trashed bonus / perk. */
export async function permanentlyDeleteBonusOrPerk(input: { id: string }): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'record_bonus_or_perk');
  const parsed = z.object({ id: z.string().uuid() }).parse(input);

  const [row] = await db
    .select({ id: bonusesAndPerks.id, description: bonusesAndPerks.description })
    .from(bonusesAndPerks)
    .where(and(eq(bonusesAndPerks.id, parsed.id), isNotNull(bonusesAndPerks.deletedAt)))
    .limit(1);
  if (!row) throw new AppError('not_found', 'Bonus not found in the Trash.');

  await db.delete(bonusesAndPerks).where(eq(bonusesAndPerks.id, row.id));
  await logAudit({
    actorId: ctx.userId,
    entityType: 'bonus',
    entityId: row.id,
    action: 'delete',
    changes: { permanent: true, description: row.description },
  });
}

/* -------------------------------------------------------------------------- */
/* Reimbursements                                                              */
/* -------------------------------------------------------------------------- */

const SubmitReimbursementSchema = z
  .object({
    employeeId: z.string().uuid(),
    claimDate: z.string(),
    amountPaise: z.bigint().positive(),
    attribution: ReimbursementAttributionEnum,
    onBehalfOfClientId: z.string().uuid().nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
    description: z.string().min(1),
    receiptDocumentId: z.string().uuid(),
    notes: z.string().optional().nullable(),
  })
  .refine(
    (v) =>
      v.attribution !== 'client' ||
      (v.onBehalfOfClientId !== null && v.onBehalfOfClientId !== undefined),
    {
      message: 'Client-attributed reimbursements require on_behalf_of_client_id.',
      path: ['onBehalfOfClientId'],
    },
  );

export type SubmitReimbursementInput = z.infer<typeof SubmitReimbursementSchema>;

export async function submitReimbursement(
  input: SubmitReimbursementInput,
): Promise<{ id: string }> {
  const ctx = await getActorContext();
  // Employees can submit their own reimbursements (portal_access);
  // managers/admins/partners can submit on behalf of anyone.
  // No explicit capability check on submit — RLS (employee scope) enforces
  // self-only for the portal user via current_employee_id().
  await getActorContext();
  const parsed = SubmitReimbursementSchema.parse(input);

  const [row] = await db
    .insert(reimbursements)
    .values({
      employeeId: parsed.employeeId,
      claimDate: parsed.claimDate,
      amountPaise: parsed.amountPaise,
      attribution: parsed.attribution,
      onBehalfOfClientId: parsed.onBehalfOfClientId ?? null,
      projectId: parsed.projectId ?? null,
      description: parsed.description,
      receiptDocumentId: parsed.receiptDocumentId,
      status: 'submitted',
      notes: parsed.notes ?? null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning({ id: reimbursements.id });
  if (!row) throw new AppError('internal', 'reimbursements insert returned no row');
  return { id: row.id };
}

export async function approveReimbursement(args: {
  id: string;
  accept: boolean;
  notes?: string | null;
}): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'approve_reimbursement');

  await db
    .update(reimbursements)
    .set({
      status: args.accept ? 'approved' : 'rejected',
      approvedBy: ctx.userId,
      approvedAt: new Date(),
      notes: args.notes ?? null,
      updatedBy: ctx.userId,
    })
    .where(eq(reimbursements.id, args.id));
}

export type ReimbursementRow = {
  id: string;
  claimDate: string;
  amountPaise: bigint;
  attribution: 'client' | 'opex';
  status: 'submitted' | 'approved' | 'rejected' | 'paid';
  description: string;
  onBehalfOfClientId: string | null;
  projectId: string | null;
};

export async function listEmployeeReimbursements(
  employeeId: string,
): Promise<readonly ReimbursementRow[]> {
  await getActorContext();
  const rows = await db
    .select()
    .from(reimbursements)
    .where(and(eq(reimbursements.employeeId, employeeId), isNull(reimbursements.deletedAt)))
    .orderBy(desc(reimbursements.claimDate))
    .limit(50);
  return rows.map((r) => ({
    id: r.id,
    claimDate: r.claimDate,
    amountPaise: r.amountPaise,
    attribution: r.attribution,
    status: r.status,
    description: r.description,
    onBehalfOfClientId: r.onBehalfOfClientId,
    projectId: r.projectId,
  }));
}

/* -------------------------------------------------------------------------- */
/* Leaves                                                                      */
/* -------------------------------------------------------------------------- */

const ApplyLeaveSchema = z.object({
  employeeId: z.string().uuid(),
  kind: LeaveKindEnum,
  fromDate: z.string(),
  toDate: z.string(),
  days: z.string().regex(/^\d+(\.\d)?$/, 'Days must be a numeric string (half-day allowed).'),
  notes: z.string().optional().nullable(),
});

export type ApplyLeaveInput = z.infer<typeof ApplyLeaveSchema>;

export async function applyLeave(input: ApplyLeaveInput): Promise<{ id: string }> {
  const ctx = await getActorContext();
  const parsed = ApplyLeaveSchema.parse(input);

  const [row] = await db
    .insert(leaves)
    .values({
      employeeId: parsed.employeeId,
      kind: parsed.kind,
      fromDate: parsed.fromDate,
      toDate: parsed.toDate,
      days: parsed.days,
      status: 'applied',
      notes: parsed.notes ?? null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning({ id: leaves.id });
  if (!row) throw new AppError('internal', 'leaves insert returned no row');
  return { id: row.id };
}

export async function approveLeave(args: {
  id: string;
  accept: boolean;
  notes?: string | null;
}): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'approve_leave');
  await db
    .update(leaves)
    .set({
      status: args.accept ? 'approved' : 'rejected',
      approvedBy: ctx.userId,
      approvedAt: new Date(),
      notes: args.notes ?? null,
      updatedBy: ctx.userId,
    })
    .where(eq(leaves.id, args.id));
}

export type LeaveRow = {
  id: string;
  kind: 'earned' | 'casual' | 'sick' | 'unpaid' | 'comp_off' | 'maternity' | 'paternity';
  fromDate: string;
  toDate: string;
  days: string;
  status: 'applied' | 'approved' | 'rejected' | 'cancelled';
  notes: string | null;
};

export async function listEmployeeLeaves(employeeId: string): Promise<readonly LeaveRow[]> {
  await getActorContext();
  const rows = await db
    .select()
    .from(leaves)
    .where(and(eq(leaves.employeeId, employeeId), isNull(leaves.deletedAt)))
    .orderBy(desc(leaves.fromDate))
    .limit(50);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    fromDate: r.fromDate,
    toDate: r.toDate,
    days: r.days,
    status: r.status,
    notes: r.notes,
  }));
}

/* -------------------------------------------------------------------------- */
/* Salary structures                                                           */
/* -------------------------------------------------------------------------- */

export type SalaryAllowanceLine = {
  label: string;
  amountPaise: string; // string-encoded bigint (jsonb stores text-safe values)
};

export type SalaryStructureRow = {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  basicPaise: bigint;
  hraPaise: bigint;
  specialAllowancePaise: bigint;
  otherAllowances: readonly SalaryAllowanceLine[];
  employerEpfPaise: bigint;
  employerEsiPaise: bigint;
  ctcMonthlyPaise: bigint;
  sourceDocumentId: string | null;
  notes: string | null;
};

function parseAllowances(raw: unknown): readonly SalaryAllowanceLine[] {
  if (!Array.isArray(raw)) return [];
  const out: SalaryAllowanceLine[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const label = (r as { label?: unknown }).label;
    const amt = (r as { amountPaise?: unknown }).amountPaise;
    if (typeof label !== 'string' || label.trim() === '') continue;
    if (typeof amt !== 'string' && typeof amt !== 'number') continue;
    out.push({ label, amountPaise: String(amt) });
  }
  return out;
}

export async function listEmployeeSalaryStructures(
  employeeId: string,
): Promise<readonly SalaryStructureRow[]> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'view_salary');

  const rows = await db
    .select()
    .from(salaryStructures)
    .where(and(eq(salaryStructures.employeeId, employeeId), isNull(salaryStructures.deletedAt)))
    .orderBy(desc(salaryStructures.effectiveFrom))
    .limit(20);
  return rows.map((r) => ({
    id: r.id,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    basicPaise: r.basicPaise,
    hraPaise: r.hraPaise,
    specialAllowancePaise: r.specialAllowancePaise,
    otherAllowances: parseAllowances(r.otherAllowances),
    employerEpfPaise: r.employerEpfPaise,
    employerEsiPaise: r.employerEsiPaise,
    ctcMonthlyPaise: r.ctcMonthlyPaise,
    sourceDocumentId: r.sourceDocumentId,
    notes: r.notes,
  }));
}

const PaiseBigInt = z
  .union([z.bigint(), z.string(), z.number()])
  .transform((v) => (typeof v === 'bigint' ? v : BigInt(v)))
  .refine((v) => v >= 0n, 'amount must be ≥ 0');

const CreateSalaryStructureSchema = z.object({
  employeeId: z.string().uuid(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'effective_from must be YYYY-MM-DD'),
  basicPaise: PaiseBigInt,
  hraPaise: PaiseBigInt.default(0n as unknown as bigint),
  specialAllowancePaise: PaiseBigInt.default(0n as unknown as bigint),
  otherAllowances: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        amountPaise: PaiseBigInt,
      }),
    )
    .max(20)
    .default([]),
  employerEpfPaise: PaiseBigInt.default(0n as unknown as bigint),
  employerEsiPaise: PaiseBigInt.default(0n as unknown as bigint),
  ctcMonthlyPaise: PaiseBigInt,
  sourceDocumentId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type CreateSalaryStructureInput = z.input<typeof CreateSalaryStructureSchema>;

/**
 * Create a new salary structure for an employee, effective from a given
 * date. If a previous open structure exists, automatically close it on
 * the day before `effectiveFrom` so versions don't overlap.
 *
 * Amounts are captured (never computed). HR enters basic / HRA / etc.
 * from the offer or revision letter; CTC is also captured (we don't
 * sum components to derive it).
 */
export async function createSalaryStructure(
  input: CreateSalaryStructureInput,
): Promise<{ id: string }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_salary_structures');
  const parsed = CreateSalaryStructureSchema.parse(input);

  // A second version starting the SAME day would overlap (the close below
  // only clips versions that began earlier) — refuse up front.
  const [sameFrom] = await db
    .select({ id: salaryStructures.id })
    .from(salaryStructures)
    .where(
      and(
        eq(salaryStructures.employeeId, parsed.employeeId),
        isNull(salaryStructures.deletedAt),
        sql`${salaryStructures.effectiveFrom} = ${parsed.effectiveFrom}::date`,
      ),
    )
    .limit(1);
  if (sameFrom) {
    throw new AppError(
      'validation',
      `A salary update already starts on ${parsed.effectiveFrom} — delete it first or pick another date.`,
    );
  }

  const newId = await db.transaction(async (tx) => {
    // Close prior structures that STARTED BEFORE this one and still cover its
    // start (open, or ending on/after it), setting their effective_to to the
    // day before the new start.
    //
    // The `effective_from < newFrom` guard is essential: without it, a
    // back-dated insert would match a LATER open structure and push its
    // effective_to before its OWN effective_from — an inverted interval that
    // silently destroyed that structure's captured comp (it could never be
    // selected as "active" again). Only structures that began earlier may be
    // closed by a new one.
    await tx
      .update(salaryStructures)
      .set({
        effectiveTo: sql`(${parsed.effectiveFrom}::date - INTERVAL '1 day')::date`,
        updatedBy: ctx.userId,
      })
      .where(
        and(
          eq(salaryStructures.employeeId, parsed.employeeId),
          isNull(salaryStructures.deletedAt),
          sql`${salaryStructures.effectiveFrom} < ${parsed.effectiveFrom}::date`,
          or(
            isNull(salaryStructures.effectiveTo),
            sql`${salaryStructures.effectiveTo} >= ${parsed.effectiveFrom}::date`,
          ),
        ),
      );

    // If a LATER structure already exists (starts after this one), bound the new
    // row so it ends the day before that later structure begins — otherwise a
    // back-dated insert would run open and overlap it (two active structures).
    const [laterStruct] = await tx
      .select({ effectiveFrom: salaryStructures.effectiveFrom })
      .from(salaryStructures)
      .where(
        and(
          eq(salaryStructures.employeeId, parsed.employeeId),
          isNull(salaryStructures.deletedAt),
          sql`${salaryStructures.effectiveFrom} > ${parsed.effectiveFrom}::date`,
        ),
      )
      .orderBy(asc(salaryStructures.effectiveFrom))
      .limit(1);
    const newEffectiveTo = laterStruct ? dayBeforeIso(laterStruct.effectiveFrom) : null;

    const otherAllowancesJson = parsed.otherAllowances.map((a) => ({
      label: a.label,
      amountPaise: a.amountPaise.toString(),
    }));

    const [row] = await tx
      .insert(salaryStructures)
      .values({
        employeeId: parsed.employeeId,
        effectiveFrom: parsed.effectiveFrom,
        effectiveTo: newEffectiveTo,
        basicPaise: parsed.basicPaise,
        hraPaise: parsed.hraPaise,
        specialAllowancePaise: parsed.specialAllowancePaise,
        otherAllowances: otherAllowancesJson,
        employerEpfPaise: parsed.employerEpfPaise,
        employerEsiPaise: parsed.employerEsiPaise,
        ctcMonthlyPaise: parsed.ctcMonthlyPaise,
        sourceDocumentId: parsed.sourceDocumentId ?? null,
        notes: parsed.notes ?? null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: salaryStructures.id });
    if (!row) throw new AppError('internal', 'salary_structures insert returned no row');
    return row.id;
  });

  return { id: newId };
}

/**
 * Delete a salary update (structure version) into the Trash. If the version
 * immediately before it was clipped to end the day before this one started,
 * that prior version is re-extended to cover the gap — deleting a wrong
 * update puts the previous salary back in force.
 */
export async function deleteSalaryStructure(input: { id: string }): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_salary_structures');
  const parsed = z.object({ id: z.string().uuid() }).parse(input);

  const [row] = await db
    .select()
    .from(salaryStructures)
    .where(and(eq(salaryStructures.id, parsed.id), isNull(salaryStructures.deletedAt)))
    .limit(1);
  if (!row) throw new AppError('not_found', 'Salary update not found.');

  await db.transaction(async (tx) => {
    // Heal the chain: the version createSalaryStructure clipped to the day
    // before this one (if any) takes over this version's span again.
    await tx
      .update(salaryStructures)
      .set({ effectiveTo: row.effectiveTo, updatedBy: ctx.userId })
      .where(
        and(
          eq(salaryStructures.employeeId, row.employeeId),
          isNull(salaryStructures.deletedAt),
          sql`${salaryStructures.effectiveTo} = (${row.effectiveFrom}::date - INTERVAL '1 day')::date`,
        ),
      );
    await tx
      .update(salaryStructures)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(salaryStructures.id, row.id));
  });

  await logAudit({
    actorId: ctx.userId,
    entityType: 'salary_structure',
    entityId: row.id,
    action: 'delete',
    changes: {
      soft_delete: true,
      effectiveFrom: row.effectiveFrom,
      ctcMonthlyPaise: String(row.ctcMonthlyPaise),
    },
  });
  await logActivity({
    entityType: 'employee',
    entityId: row.employeeId,
    actorId: ctx.userId,
    kind: 'salary_structure.deleted',
    summary: `Salary update effective ${row.effectiveFrom} (CTC ${inr(row.ctcMonthlyPaise)}) moved to Trash`,
  });
}

/**
 * Restore a trashed salary update. Re-applies the same overlap rules as
 * createSalaryStructure: earlier versions covering its start get clipped to
 * the day before, and the restored version is bounded by the next later one.
 */
export async function restoreSalaryStructure(input: { id: string }): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_salary_structures');
  const parsed = z.object({ id: z.string().uuid() }).parse(input);

  const [row] = await db
    .select()
    .from(salaryStructures)
    .where(and(eq(salaryStructures.id, parsed.id), isNotNull(salaryStructures.deletedAt)))
    .limit(1);
  if (!row) throw new AppError('not_found', 'Salary update not found in the Trash.');

  // An active version with the SAME start date would overlap the restored one
  // (the clip below only closes versions that began earlier) — refuse instead
  // of leaving payroll with two structures in force for the same span.
  const [sameFrom] = await db
    .select({ id: salaryStructures.id })
    .from(salaryStructures)
    .where(
      and(
        eq(salaryStructures.employeeId, row.employeeId),
        isNull(salaryStructures.deletedAt),
        sql`${salaryStructures.effectiveFrom} = ${row.effectiveFrom}::date`,
      ),
    )
    .limit(1);
  if (sameFrom) {
    throw new AppError(
      'validation',
      `A salary update effective ${row.effectiveFrom} already exists — delete it first to restore this one.`,
    );
  }

  await db.transaction(async (tx) => {
    // Clip earlier active versions that cover this one's start (same guard as
    // createSalaryStructure — only versions that began earlier get closed).
    await tx
      .update(salaryStructures)
      .set({
        effectiveTo: sql`(${row.effectiveFrom}::date - INTERVAL '1 day')::date`,
        updatedBy: ctx.userId,
      })
      .where(
        and(
          eq(salaryStructures.employeeId, row.employeeId),
          isNull(salaryStructures.deletedAt),
          sql`${salaryStructures.effectiveFrom} < ${row.effectiveFrom}::date`,
          or(
            isNull(salaryStructures.effectiveTo),
            sql`${salaryStructures.effectiveTo} >= ${row.effectiveFrom}::date`,
          ),
        ),
      );
    // Bound the restored version against the next later active version.
    const [laterStruct] = await tx
      .select({ effectiveFrom: salaryStructures.effectiveFrom })
      .from(salaryStructures)
      .where(
        and(
          eq(salaryStructures.employeeId, row.employeeId),
          isNull(salaryStructures.deletedAt),
          sql`${salaryStructures.effectiveFrom} > ${row.effectiveFrom}::date`,
        ),
      )
      .orderBy(asc(salaryStructures.effectiveFrom))
      .limit(1);
    await tx
      .update(salaryStructures)
      .set({
        deletedAt: null,
        effectiveTo: laterStruct ? dayBeforeIso(laterStruct.effectiveFrom) : null,
        updatedBy: ctx.userId,
      })
      .where(eq(salaryStructures.id, row.id));
  });

  await logAudit({
    actorId: ctx.userId,
    entityType: 'salary_structure',
    entityId: row.id,
    action: 'update',
    changes: { restore: true },
  });
  await logActivity({
    entityType: 'employee',
    entityId: row.employeeId,
    actorId: ctx.userId,
    kind: 'salary_structure.restored',
    summary: `Salary update effective ${row.effectiveFrom} (CTC ${inr(row.ctcMonthlyPaise)}) restored from Trash`,
  });
}

/** Hard-delete a trashed salary update (versioning was already healed on delete). */
export async function permanentlyDeleteSalaryStructure(input: { id: string }): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_salary_structures');
  const parsed = z.object({ id: z.string().uuid() }).parse(input);

  const [row] = await db
    .select({ id: salaryStructures.id, effectiveFrom: salaryStructures.effectiveFrom })
    .from(salaryStructures)
    .where(and(eq(salaryStructures.id, parsed.id), isNotNull(salaryStructures.deletedAt)))
    .limit(1);
  if (!row) throw new AppError('not_found', 'Salary update not found in the Trash.');

  await db.delete(salaryStructures).where(eq(salaryStructures.id, row.id));
  await logAudit({
    actorId: ctx.userId,
    entityType: 'salary_structure',
    entityId: row.id,
    action: 'delete',
    changes: { permanent: true, effectiveFrom: row.effectiveFrom },
  });
}

/* -------------------------------------------------------------------------- */
/* Salary payments (disbursements actually given out)                          */
/* -------------------------------------------------------------------------- */

export type SalaryPaymentRow = {
  id: string;
  paidOn: string;
  amountPaise: bigint;
  /** Attendance-prorated gross the employee was DUE, snapshotted at record time. */
  expectedAmountPaise: bigint | null;
  /** How the salary was paid out: cash (1110), bank or cheque (1120 sub-ledger). */
  paymentMethod: 'cash' | 'bank' | 'cheque';
  bankAccountId: string | null;
  /** "HDFC Current ••1234" — resolved from bank_accounts for display. */
  bankLabel: string | null;
  /** Cheque capture (0064) — set when paymentMethod='cheque'. */
  chequeNumber: string | null;
  chequeDate: string | null;
  notes: string | null;
  /** Ledger transaction this payment posted to (open it in the txn window). */
  transactionId: string | null;
};

const RecordSalaryPaymentSchema = z
  .object({
    employeeId: z.string().uuid(),
    paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'paid_on must be YYYY-MM-DD'),
    amountPaise: PaiseBigInt.refine((v) => v > 0n, 'amount must be greater than 0'),
    /** What the employee deserved for the period (attendance-prorated). */
    expectedAmountPaise: PaiseBigInt.nullable().optional(),
    /** 'bank'/'cheque' → Cr 1120 (needs bankAccountId); 'cash' → Cr 1110. */
    mode: z.enum(['bank', 'cash', 'cheque']).default('cash'),
    bankAccountId: z.string().uuid().nullable().optional(),
    /** Cheque capture (0064) — required when mode='cheque'. */
    chequeNumber: z.string().trim().max(40).nullable().optional(),
    chequeDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => v.mode === 'cash' || !!v.bankAccountId, {
    message: 'Pick the bank account the salary was paid from.',
    path: ['bankAccountId'],
  })
  .refine((v) => v.mode !== 'cheque' || !!v.chequeNumber?.trim(), {
    message: 'Enter the cheque number.',
    path: ['chequeNumber'],
  });

export type RecordSalaryPaymentInput = z.input<typeof RecordSalaryPaymentSchema>;

/**
 * Record a salary disbursement (amount + date) actually paid to an employee.
 * Captured, not computed. Posts a real double-entry transaction
 * (Dr 6100 Salaries & Wages / Cr 1110 Cash on Hand) attributed to the employee
 * on the header, then stores a capture row linking to it — so the payment shows
 * in the company books, deducts office cash, and feeds the per-employee book.
 */
export async function recordSalaryPayment(
  input: RecordSalaryPaymentInput,
): Promise<{ id: string; transactionId: string }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_salary_structures');
  // Posting the entry needs both — fail fast rather than leave an orphan draft.
  requireCapability(ctx, 'post_transaction');
  const parsed = RecordSalaryPaymentSchema.parse(input);

  // Cheque narration suffix — every list/statement shows it without read-path
  // changes (mirrors recordClientReceipt/recordVendorPayment).
  const chequeSuffix =
    parsed.mode === 'cheque' && parsed.chequeNumber
      ? `Cheque #${parsed.chequeNumber.trim()}${parsed.chequeDate ? ` dt ${parsed.chequeDate}` : ''}`
      : null;
  const notesWithCheque = chequeSuffix
    ? parsed.notes?.trim()
      ? `${parsed.notes.trim()} · ${chequeSuffix}`
      : chequeSuffix
    : (parsed.notes ?? null);

  const externalRef = `SAL-${parsed.paidOn}-${parsed.employeeId.slice(0, 8)}-${Date.now()}`;
  const { transactionId } = await createDraftTransaction(ctx, {
    kind: 'salary_disbursement',
    input: {
      employeeId: parsed.employeeId,
      amountPaise: parsed.amountPaise,
      mode: parsed.mode,
      bankAccountId: parsed.mode !== 'cash' ? (parsed.bankAccountId ?? null) : null,
      chequeNumber: parsed.mode === 'cheque' ? (parsed.chequeNumber ?? null) : null,
      chequeDate: parsed.mode === 'cheque' ? (parsed.chequeDate ?? null) : null,
      txnDate: parsed.paidOn,
      externalRef,
      notes: notesWithCheque,
    },
  });
  await postTransaction(ctx, { transactionId });

  const [row] = await db
    .insert(salaryPayments)
    .values({
      employeeId: parsed.employeeId,
      paidOn: parsed.paidOn,
      amountPaise: parsed.amountPaise,
      expectedAmountPaise: parsed.expectedAmountPaise ?? null,
      paymentMethod: parsed.mode,
      bankAccountId: parsed.mode !== 'cash' ? (parsed.bankAccountId ?? null) : null,
      chequeNumber: parsed.mode === 'cheque' ? (parsed.chequeNumber ?? null) : null,
      chequeDate: parsed.mode === 'cheque' ? (parsed.chequeDate ?? null) : null,
      notes: notesWithCheque,
      transactionId,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning({ id: salaryPayments.id });
  if (!row) throw new AppError('internal', 'salary_payments insert returned no row');
  return { id: row.id, transactionId };
}

const RecordSalaryPaymentsBulkSchema = z
  .object({
    paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'paid_on must be YYYY-MM-DD'),
    /** Bulk supports cash / bank only — cheque carries per-payment numbers, so
     *  cheque salaries stay on the single per-employee path. */
    mode: z.enum(['bank', 'cash']).default('cash'),
    bankAccountId: z.string().uuid().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    lines: z
      .array(
        z.object({
          employeeId: z.string().uuid(),
          amountPaise: PaiseBigInt.refine((v) => v > 0n, 'amount must be greater than 0'),
          expectedAmountPaise: PaiseBigInt.nullable().optional(),
          notes: z.string().max(2000).nullable().optional(),
        }),
      )
      .min(1, 'Select at least one salary to record.')
      .max(200, 'Record at most 200 salaries at once.'),
  })
  .refine((v) => v.mode === 'cash' || !!v.bankAccountId, {
    message: 'Pick the bank account the salaries were paid from.',
    path: ['bankAccountId'],
  });

export type RecordSalaryPaymentsBulkInput = z.input<typeof RecordSalaryPaymentsBulkSchema>;

export type RecordSalaryPaymentsBulkResult = {
  results: {
    employeeId: string;
    ok: boolean;
    id?: string;
    transactionId?: string;
    error?: string;
  }[];
  postedCount: number;
  /** Total paise actually posted (successful lines only), as a string. */
  totalPaise: string;
};

/**
 * Record many salary disbursements in one call — the "Record selected" action of
 * the Salaries-to-be-Paid window. Loops the single-payment path so each line
 * posts its own immutable double-entry txn (Dr 6100 / Cr 1110-or-1120).
 *
 * Deliberately NON-atomic: each posted txn is immutable, so a mid-batch failure
 * can't be rolled back. Per-line failures are caught and returned in `results`
 * rather than aborting the whole batch (mirrors the office-import contract).
 */
export async function recordSalaryPaymentsBulk(
  input: RecordSalaryPaymentsBulkInput,
): Promise<RecordSalaryPaymentsBulkResult> {
  const ctx = await getActorContext();
  // Fail fast on the caps the per-line path also checks, so an unauthorized
  // operator gets one clean error instead of N identical ones.
  requireCapability(ctx, 'manage_salary_structures');
  requireCapability(ctx, 'post_transaction');
  const parsed = RecordSalaryPaymentsBulkSchema.parse(input);

  const results: RecordSalaryPaymentsBulkResult['results'] = [];
  let postedCount = 0;
  let totalPaise = 0n;
  for (const line of parsed.lines) {
    try {
      const res = await recordSalaryPayment({
        employeeId: line.employeeId,
        paidOn: parsed.paidOn,
        amountPaise: line.amountPaise,
        expectedAmountPaise: line.expectedAmountPaise ?? line.amountPaise,
        mode: parsed.mode,
        bankAccountId: parsed.mode === 'bank' ? (parsed.bankAccountId ?? null) : null,
        notes: line.notes ?? parsed.notes ?? null,
      });
      results.push({
        employeeId: line.employeeId,
        ok: true,
        id: res.id,
        transactionId: res.transactionId,
      });
      postedCount += 1;
      totalPaise += line.amountPaise;
    } catch (e) {
      results.push({
        employeeId: line.employeeId,
        ok: false,
        error: e instanceof Error ? e.message : 'Failed to record',
      });
    }
  }
  return { results, postedCount, totalPaise: totalPaise.toString() };
}

export async function listEmployeeSalaryPayments(
  employeeId: string,
): Promise<readonly SalaryPaymentRow[]> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'view_salary');
  const rows = await db
    .select({
      id: salaryPayments.id,
      paidOn: salaryPayments.paidOn,
      amountPaise: salaryPayments.amountPaise,
      expectedAmountPaise: salaryPayments.expectedAmountPaise,
      paymentMethod: salaryPayments.paymentMethod,
      bankAccountId: salaryPayments.bankAccountId,
      bankDisplayName: bankAccounts.displayName,
      bankAccountLast4: bankAccounts.accountLast4,
      chequeNumber: salaryPayments.chequeNumber,
      chequeDate: salaryPayments.chequeDate,
      notes: salaryPayments.notes,
      transactionId: salaryPayments.transactionId,
    })
    .from(salaryPayments)
    .leftJoin(bankAccounts, eq(bankAccounts.id, salaryPayments.bankAccountId))
    .where(and(eq(salaryPayments.employeeId, employeeId), isNull(salaryPayments.deletedAt)))
    .orderBy(desc(salaryPayments.paidOn))
    .limit(100);
  return rows.map(
    (r): SalaryPaymentRow => ({
      id: r.id,
      paidOn: r.paidOn,
      amountPaise: r.amountPaise,
      expectedAmountPaise: r.expectedAmountPaise,
      // Don't collapse cheque to cash — 0064 widened the CHECK.
      paymentMethod:
        r.paymentMethod === 'bank' ? 'bank' : r.paymentMethod === 'cheque' ? 'cheque' : 'cash',
      bankAccountId: r.bankAccountId,
      bankLabel: r.bankDisplayName ? `${r.bankDisplayName} ••${r.bankAccountLast4 ?? ''}` : null,
      chequeNumber: r.chequeNumber,
      chequeDate: r.chequeDate,
      notes: r.notes,
      transactionId: r.transactionId,
    }),
  );
}

/**
 * Remove a salary payment: reverse its ledger transaction (a paired reversal,
 * never a delete) and soft-delete the capture row, so the office balance and
 * the per-employee book both drop back.
 */
export async function deleteSalaryPayment(id: string): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_salary_structures');
  const [row] = await db
    .select({
      id: salaryPayments.id,
      employeeId: salaryPayments.employeeId,
      paidOn: salaryPayments.paidOn,
      amountPaise: salaryPayments.amountPaise,
      transactionId: salaryPayments.transactionId,
    })
    .from(salaryPayments)
    .where(and(eq(salaryPayments.id, id), isNull(salaryPayments.deletedAt)))
    .limit(1);
  if (!row) return;
  if (row.transactionId) {
    requireCapability(ctx, 'reverse_transaction');
    await reverseTransaction(ctx, {
      transactionId: row.transactionId,
      reason: 'Salary payment deleted from the Salary Book.',
    });
  }
  await db
    .update(salaryPayments)
    .set({ deletedAt: new Date(), updatedBy: ctx.userId })
    .where(eq(salaryPayments.id, id));

  await logAudit({
    actorId: ctx.userId,
    entityType: 'salary_payment',
    entityId: row.id,
    action: 'delete',
    changes: {
      soft_delete: true,
      reversed: !!row.transactionId,
      amountPaise: String(row.amountPaise),
      paidOn: row.paidOn,
    },
  });
  // Activity tab entry (30-day retention) — the user-visible deletion log.
  await logActivity({
    entityType: 'employee',
    entityId: row.employeeId,
    actorId: ctx.userId,
    kind: 'salary_payment.deleted',
    summary: `Salary payment of ${inr(row.amountPaise)} (paid ${row.paidOn}) moved to Trash`,
  });
}

/**
 * Bring a trashed salary payment back: clear the soft delete and RE-POST the
 * disbursement (the delete reversed the original transaction, so restore posts
 * a fresh one and relinks it). The office balance and per-employee book both
 * pick the amount back up.
 */
export async function restoreSalaryPayment(input: { id: string }): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_salary_structures');
  requireCapability(ctx, 'post_transaction');
  const parsed = z.object({ id: z.string().uuid() }).parse(input);

  const [row] = await db
    .select()
    .from(salaryPayments)
    .where(and(eq(salaryPayments.id, parsed.id), isNotNull(salaryPayments.deletedAt)))
    .limit(1);
  if (!row) throw new AppError('not_found', 'Salary payment not found in the Trash.');

  const mode =
    row.paymentMethod === 'bank'
      ? ('bank' as const)
      : row.paymentMethod === 'cheque'
        ? ('cheque' as const)
        : ('cash' as const);
  // The bank account FK is ON DELETE SET NULL — restoring a bank/cheque
  // payment whose account is gone would silently fall back to crediting
  // office cash. Refuse with a clear message instead.
  if (mode !== 'cash' && !row.bankAccountId) {
    throw new AppError(
      'validation',
      'This payment was made from a bank account that no longer exists. Record it afresh instead of restoring.',
    );
  }
  const externalRef = `SAL-${row.paidOn}-${row.employeeId.slice(0, 8)}-${Date.now()}`;
  const { transactionId } = await createDraftTransaction(ctx, {
    kind: 'salary_disbursement',
    input: {
      employeeId: row.employeeId,
      amountPaise: row.amountPaise,
      mode,
      bankAccountId: mode !== 'cash' ? row.bankAccountId : null,
      chequeNumber: mode === 'cheque' ? row.chequeNumber : null,
      chequeDate: mode === 'cheque' ? row.chequeDate : null,
      txnDate: row.paidOn,
      externalRef,
      notes: row.notes,
    },
  });
  await postTransaction(ctx, { transactionId });

  await db
    .update(salaryPayments)
    .set({ deletedAt: null, transactionId, updatedBy: ctx.userId })
    .where(eq(salaryPayments.id, row.id));

  await logAudit({
    actorId: ctx.userId,
    entityType: 'salary_payment',
    entityId: row.id,
    action: 'update',
    changes: { restore: true, repostedTransactionId: transactionId },
  });
  await logActivity({
    entityType: 'employee',
    entityId: row.employeeId,
    actorId: ctx.userId,
    kind: 'salary_payment.restored',
    summary: `Salary payment of ${inr(row.amountPaise)} (paid ${row.paidOn}) restored from Trash`,
  });
}

/** Hard-delete a trashed salary payment (its ledger effect was already reversed on delete). */
export async function permanentlyDeleteSalaryPayment(input: { id: string }): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_salary_structures');
  const parsed = z.object({ id: z.string().uuid() }).parse(input);

  const [row] = await db
    .select({
      id: salaryPayments.id,
      employeeId: salaryPayments.employeeId,
      paidOn: salaryPayments.paidOn,
      amountPaise: salaryPayments.amountPaise,
    })
    .from(salaryPayments)
    .where(and(eq(salaryPayments.id, parsed.id), isNotNull(salaryPayments.deletedAt)))
    .limit(1);
  if (!row) throw new AppError('not_found', 'Salary payment not found in the Trash.');

  await db.delete(salaryPayments).where(eq(salaryPayments.id, row.id));
  await logAudit({
    actorId: ctx.userId,
    entityType: 'salary_payment',
    entityId: row.id,
    action: 'delete',
    changes: { permanent: true, amountPaise: String(row.amountPaise), paidOn: row.paidOn },
  });
}

export type SalaryPaymentsSummary = {
  /** Sum of all (non-deleted) salary payments in range — the office deduction. */
  totalPaise: bigint;
  count: number;
  latestPaidOn: string | null;
};

/**
 * Cumulative salary disbursed across all employees, optionally within a date
 * range (paid_on). Backs the Office app KPI and the Office Ledger's
 * net-of-salaries figure. Aggregate only — not gated by `view_salary`, mirroring
 * the office cash/expense summaries.
 */
export async function getSalaryPaymentsSummary(args?: {
  from?: string;
  to?: string;
}): Promise<SalaryPaymentsSummary> {
  await getActorContext();
  const conds = [isNull(salaryPayments.deletedAt)];
  if (args?.from) conds.push(sql`${salaryPayments.paidOn} >= ${args.from}`);
  if (args?.to) conds.push(sql`${salaryPayments.paidOn} <= ${args.to}`);

  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${salaryPayments.amountPaise}), 0)::text`,
      count: sql<string>`count(*)::text`,
      latest: sql<string | null>`max(${salaryPayments.paidOn})::text`,
    })
    .from(salaryPayments)
    .where(and(...conds));

  return {
    totalPaise: row ? BigInt(row.total) : 0n,
    count: row ? Number(row.count) : 0,
    latestPaidOn: row?.latest ?? null,
  };
}

export type SalaryBookRow = {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  totalPaise: bigint;
  count: number;
  lastPaidOn: string | null;
};

/** One employee's slice of a given month. */
export type SalaryMonthEmployee = {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  totalPaise: bigint;
  count: number;
};

/** All salary paid in a single calendar month (`YYYY-MM`), newest first. */
export type SalaryMonthRow = {
  month: string; // 'YYYY-MM'
  totalPaise: bigint;
  count: number;
  employeeCount: number;
  employees: readonly SalaryMonthEmployee[];
};

export type SalaryBook = {
  rows: readonly SalaryBookRow[];
  byMonth: readonly SalaryMonthRow[];
  totalPaise: bigint;
};

/**
 * Salary book — how much has been paid, optionally within a date range
 * (paid_on). Returns both views off one query: `rows` per employee (highest
 * first) and `byMonth` per calendar month (newest first, each with its
 * per-employee breakdown). Backs the dedicated Salary Book window and the Office
 * Ledger's per-employee breakdown. Mirrors the posted ledger transactions
 * one-to-one. Aggregate only — not gated by `view_salary`.
 */
export async function getSalaryBook(args?: { from?: string; to?: string }): Promise<SalaryBook> {
  await getActorContext();
  const conds = [isNull(salaryPayments.deletedAt)];
  if (args?.from) conds.push(sql`${salaryPayments.paidOn} >= ${args.from}`);
  if (args?.to) conds.push(sql`${salaryPayments.paidOn} <= ${args.to}`);

  // One row per (employee, month) — enough to assemble both the per-employee
  // and per-month views without a second round-trip.
  const grouped = await db
    .select({
      employeeId: salaryPayments.employeeId,
      employeeName: employees.fullName,
      employeeCode: employees.employeeCode,
      month: sql<string>`to_char(${salaryPayments.paidOn}, 'YYYY-MM')`,
      total: sql<string>`sum(${salaryPayments.amountPaise})::text`,
      count: sql<string>`count(*)::text`,
      last: sql<string>`max(${salaryPayments.paidOn})::text`,
    })
    .from(salaryPayments)
    .innerJoin(employees, eq(employees.id, salaryPayments.employeeId))
    .where(and(...conds))
    .groupBy(
      salaryPayments.employeeId,
      employees.fullName,
      employees.employeeCode,
      sql`to_char(${salaryPayments.paidOn}, 'YYYY-MM')`,
    );

  // Per-employee rollup.
  const byEmp = new Map<string, SalaryBookRow>();
  // Per-month rollup, each carrying its own per-employee map.
  const byMonth = new Map<
    string,
    { totalPaise: bigint; count: number; employees: Map<string, SalaryMonthEmployee> }
  >();
  let total = 0n;

  for (const g of grouped) {
    const amt = BigInt(g.total);
    const cnt = Number(g.count);
    total += amt;

    const emp = byEmp.get(g.employeeId);
    if (emp) {
      emp.totalPaise += amt;
      emp.count += cnt;
      if (!emp.lastPaidOn || g.last > emp.lastPaidOn) emp.lastPaidOn = g.last;
    } else {
      byEmp.set(g.employeeId, {
        employeeId: g.employeeId,
        employeeName: g.employeeName,
        employeeCode: g.employeeCode,
        totalPaise: amt,
        count: cnt,
        lastPaidOn: g.last,
      });
    }

    let m = byMonth.get(g.month);
    if (!m) {
      m = { totalPaise: 0n, count: 0, employees: new Map() };
      byMonth.set(g.month, m);
    }
    m.totalPaise += amt;
    m.count += cnt;
    m.employees.set(g.employeeId, {
      employeeId: g.employeeId,
      employeeName: g.employeeName,
      employeeCode: g.employeeCode,
      totalPaise: amt,
      count: cnt,
    });
  }

  const rows = [...byEmp.values()].sort((a, b) => (b.totalPaise > a.totalPaise ? 1 : -1));
  const months: SalaryMonthRow[] = [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // newest month first
    .map(([month, m]) => ({
      month,
      totalPaise: m.totalPaise,
      count: m.count,
      employeeCount: m.employees.size,
      employees: [...m.employees.values()].sort((a, b) => (b.totalPaise > a.totalPaise ? 1 : -1)),
    }));

  return { rows, byMonth: months, totalPaise: total };
}
