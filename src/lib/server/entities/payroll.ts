'use server';

import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import {
  bonusesAndPerks,
  leaves,
  reimbursements,
  salaryPayments,
  salaryStructures,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

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

  const newId = await db.transaction(async (tx) => {
    // Close any prior open or future-overlapping structure for this employee.
    // "Open" = effective_to IS NULL, "Overlapping" = effective_to >= new from.
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
          or(
            isNull(salaryStructures.effectiveTo),
            sql`${salaryStructures.effectiveTo} >= ${parsed.effectiveFrom}::date`,
          ),
        ),
      );

    const otherAllowancesJson = parsed.otherAllowances.map((a) => ({
      label: a.label,
      amountPaise: a.amountPaise.toString(),
    }));

    const [row] = await tx
      .insert(salaryStructures)
      .values({
        employeeId: parsed.employeeId,
        effectiveFrom: parsed.effectiveFrom,
        effectiveTo: null,
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

/* -------------------------------------------------------------------------- */
/* Salary payments (disbursements actually given out)                          */
/* -------------------------------------------------------------------------- */

export type SalaryPaymentRow = {
  id: string;
  paidOn: string;
  amountPaise: bigint;
  notes: string | null;
};

const RecordSalaryPaymentSchema = z.object({
  employeeId: z.string().uuid(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'paid_on must be YYYY-MM-DD'),
  amountPaise: PaiseBigInt.refine((v) => v > 0n, 'amount must be greater than 0'),
  notes: z.string().max(2000).nullable().optional(),
});

export type RecordSalaryPaymentInput = z.input<typeof RecordSalaryPaymentSchema>;

/**
 * Record a salary disbursement (amount + date) actually paid to an employee.
 * Captured, not computed. Standalone tracker — does not post to the ledger;
 * the cumulative total is surfaced in the Office app / Office Ledger.
 */
export async function recordSalaryPayment(
  input: RecordSalaryPaymentInput,
): Promise<{ id: string }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_salary_structures');
  const parsed = RecordSalaryPaymentSchema.parse(input);

  const [row] = await db
    .insert(salaryPayments)
    .values({
      employeeId: parsed.employeeId,
      paidOn: parsed.paidOn,
      amountPaise: parsed.amountPaise,
      notes: parsed.notes ?? null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning({ id: salaryPayments.id });
  if (!row) throw new AppError('internal', 'salary_payments insert returned no row');
  return { id: row.id };
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
      notes: salaryPayments.notes,
    })
    .from(salaryPayments)
    .where(and(eq(salaryPayments.employeeId, employeeId), isNull(salaryPayments.deletedAt)))
    .orderBy(desc(salaryPayments.paidOn))
    .limit(100);
  return rows;
}

export async function deleteSalaryPayment(id: string): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_salary_structures');
  await db
    .update(salaryPayments)
    .set({ deletedAt: new Date(), updatedBy: ctx.userId })
    .where(and(eq(salaryPayments.id, id), isNull(salaryPayments.deletedAt)));
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
