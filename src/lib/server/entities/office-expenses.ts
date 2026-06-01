'use server';

import { and, between, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { employees, officeExpenses, vendors } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { getActorContext } from '@/lib/server/actor';

/**
 * Server actions backing the OS Office app. Captures everyday office
 * outflows — stationary, tea/coffee, cleaning, leisure, utilities, rent,
 * reimbursements. Values are read off the source bill / receipt and
 * stored as-is (CLAUDE rules #1, #2).
 */

const CategoryEnum = z.enum([
  'stationary',
  'toiletries',
  'tea_coffee',
  'cleaning',
  'leisure',
  'utilities',
  'rent',
  'travel',
  'repairs',
  'reimbursement',
  'other',
]);

const PaymentMethodEnum = z.enum(['cash', 'bank', 'card', 'upi', 'employee_paid']);

const StatusEnum = z.enum(['pending', 'approved', 'reimbursed', 'rejected']);

export type OfficeExpenseCategory = z.infer<typeof CategoryEnum>;
export type OfficeExpensePaymentMethod = z.infer<typeof PaymentMethodEnum>;
export type OfficeExpenseStatus = z.infer<typeof StatusEnum>;

export type OfficeExpenseRow = {
  id: string;
  expenseDate: string;
  category: OfficeExpenseCategory;
  description: string;
  /** FK to a row in the vendors directory; null for one-off sellers. */
  vendorId: string | null;
  /**
   * Display name for the vendor. Sourced from `vendors.name` when
   * `vendorId` is set, falls back to the free-text `vendor_name` column
   * otherwise.
   */
  vendorName: string | null;
  employeeId: string | null;
  employeeName: string | null;
  amountPaise: bigint;
  gstPaise: bigint;
  totalPaise: bigint;
  paymentMethod: OfficeExpensePaymentMethod;
  status: OfficeExpenseStatus;
  referenceNumber: string | null;
  notes: string | null;
  createdAt: string;
};

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

const ListSchema = z.object({
  category: CategoryEnum.optional(),
  status: StatusEnum.optional(),
  employeeId: z.string().uuid().optional(),
  fromDate: z.string().regex(dateRegex).optional(),
  toDate: z.string().regex(dateRegex).optional(),
  search: z.string().max(120).optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export type ListOfficeExpensesInput = z.infer<typeof ListSchema>;

export async function listOfficeExpenses(
  input: ListOfficeExpensesInput = {},
): Promise<readonly OfficeExpenseRow[]> {
  await getActorContext();
  const parsed = ListSchema.parse(input);

  const conds = [isNull(officeExpenses.deletedAt)];
  if (parsed.category) conds.push(eq(officeExpenses.category, parsed.category));
  if (parsed.status) conds.push(eq(officeExpenses.status, parsed.status));
  if (parsed.employeeId) conds.push(eq(officeExpenses.employeeId, parsed.employeeId));
  if (parsed.fromDate && parsed.toDate) {
    conds.push(between(officeExpenses.expenseDate, parsed.fromDate, parsed.toDate));
  } else if (parsed.fromDate) {
    conds.push(sql`${officeExpenses.expenseDate} >= ${parsed.fromDate}`);
  } else if (parsed.toDate) {
    conds.push(sql`${officeExpenses.expenseDate} <= ${parsed.toDate}`);
  }
  if (parsed.search) {
    const q = `%${parsed.search}%`;
    const searchCond = or(
      ilike(officeExpenses.description, q),
      ilike(officeExpenses.vendorName, q),
      ilike(officeExpenses.referenceNumber, q),
    );
    if (searchCond) conds.push(searchCond);
  }

  const rows = await db
    .select({
      id: officeExpenses.id,
      expenseDate: officeExpenses.expenseDate,
      category: officeExpenses.category,
      description: officeExpenses.description,
      vendorId: officeExpenses.vendorId,
      vendorDirectoryName: vendors.name,
      vendorFreeTextName: officeExpenses.vendorName,
      employeeId: officeExpenses.employeeId,
      employeeName: employees.fullName,
      amountPaise: officeExpenses.amountPaise,
      gstPaise: officeExpenses.gstPaise,
      paymentMethod: officeExpenses.paymentMethod,
      status: officeExpenses.status,
      referenceNumber: officeExpenses.referenceNumber,
      notes: officeExpenses.notes,
      createdAt: officeExpenses.createdAt,
    })
    .from(officeExpenses)
    .leftJoin(employees, eq(employees.id, officeExpenses.employeeId))
    .leftJoin(vendors, eq(vendors.id, officeExpenses.vendorId))
    .where(and(...conds))
    .orderBy(desc(officeExpenses.expenseDate), desc(officeExpenses.createdAt))
    .limit(parsed.limit ?? 500);

  return rows.map(
    (r): OfficeExpenseRow => ({
      id: r.id,
      expenseDate: r.expenseDate,
      category: r.category as OfficeExpenseCategory,
      description: r.description,
      vendorId: r.vendorId,
      vendorName: r.vendorDirectoryName ?? r.vendorFreeTextName,
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      amountPaise: r.amountPaise,
      gstPaise: r.gstPaise,
      totalPaise: r.amountPaise + r.gstPaise,
      paymentMethod: r.paymentMethod as OfficeExpensePaymentMethod,
      status: r.status as OfficeExpenseStatus,
      referenceNumber: r.referenceNumber,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
    }),
  );
}

export type OfficeExpenseSummary = {
  monthTotalPaise: bigint;
  monthCount: number;
  pendingReimbursementPaise: bigint;
  pendingReimbursementCount: number;
  ytdTotalPaise: bigint;
  byCategory: Array<{ category: OfficeExpenseCategory; totalPaise: bigint; count: number }>;
  monthlyTrend: Array<{ month: string; totalPaise: bigint }>;
};

/**
 * Headline numbers for the Office app KPI strip. Aggregated in Postgres
 * (CLAUDE rule #17 — no client-side aggregation for >100 rows). Reads
 * are scoped to the active financial year and the trailing 12 months.
 */
export async function getOfficeExpenseSummary(): Promise<OfficeExpenseSummary> {
  await getActorContext();

  const now = new Date();
  const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const fyYear = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const fyStart = `${fyYear}-04-01`;
  const trendStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1))
    .toISOString()
    .slice(0, 10);

  const [monthAgg] = await db
    .select({
      total: sql<string>`coalesce(sum(${officeExpenses.amountPaise} + ${officeExpenses.gstPaise}), 0)::text`,
      count: sql<string>`count(*)::text`,
    })
    .from(officeExpenses)
    .where(
      and(isNull(officeExpenses.deletedAt), sql`${officeExpenses.expenseDate} >= ${monthStart}`),
    );

  const [ytdAgg] = await db
    .select({
      total: sql<string>`coalesce(sum(${officeExpenses.amountPaise} + ${officeExpenses.gstPaise}), 0)::text`,
    })
    .from(officeExpenses)
    .where(and(isNull(officeExpenses.deletedAt), sql`${officeExpenses.expenseDate} >= ${fyStart}`));

  const [pendingAgg] = await db
    .select({
      total: sql<string>`coalesce(sum(${officeExpenses.amountPaise} + ${officeExpenses.gstPaise}), 0)::text`,
      count: sql<string>`count(*)::text`,
    })
    .from(officeExpenses)
    .where(
      and(
        isNull(officeExpenses.deletedAt),
        eq(officeExpenses.category, 'reimbursement'),
        inArray(officeExpenses.status, ['pending', 'approved']),
      ),
    );

  const byCategoryRows = await db
    .select({
      category: officeExpenses.category,
      total: sql<string>`coalesce(sum(${officeExpenses.amountPaise} + ${officeExpenses.gstPaise}), 0)::text`,
      count: sql<string>`count(*)::text`,
    })
    .from(officeExpenses)
    .where(and(isNull(officeExpenses.deletedAt), sql`${officeExpenses.expenseDate} >= ${fyStart}`))
    .groupBy(officeExpenses.category);

  const trendRows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${officeExpenses.expenseDate}), 'YYYY-MM')`,
      total: sql<string>`coalesce(sum(${officeExpenses.amountPaise} + ${officeExpenses.gstPaise}), 0)::text`,
    })
    .from(officeExpenses)
    .where(
      and(isNull(officeExpenses.deletedAt), sql`${officeExpenses.expenseDate} >= ${trendStart}`),
    )
    .groupBy(sql`date_trunc('month', ${officeExpenses.expenseDate})`)
    .orderBy(sql`date_trunc('month', ${officeExpenses.expenseDate})`);

  return {
    monthTotalPaise: BigInt(monthAgg?.total ?? '0'),
    monthCount: Number(monthAgg?.count ?? '0'),
    pendingReimbursementPaise: BigInt(pendingAgg?.total ?? '0'),
    pendingReimbursementCount: Number(pendingAgg?.count ?? '0'),
    ytdTotalPaise: BigInt(ytdAgg?.total ?? '0'),
    byCategory: byCategoryRows.map((r) => ({
      category: r.category as OfficeExpenseCategory,
      totalPaise: BigInt(r.total),
      count: Number(r.count),
    })),
    monthlyTrend: trendRows.map((r) => ({
      month: r.month,
      totalPaise: BigInt(r.total),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

const bigintStringSchema = z
  .union([z.bigint(), z.string()])
  .transform((v) => (typeof v === 'bigint' ? v : BigInt(v)))
  .refine((v) => v >= 0n, 'must be ≥ 0');

const CreateSchema = z.object({
  expenseDate: z.string().regex(dateRegex, 'expenseDate must be YYYY-MM-DD'),
  category: CategoryEnum,
  description: z.string().min(1).max(500),
  vendorId: z.string().uuid().nullable().optional(),
  vendorName: z.string().max(200).nullable().optional(),
  employeeId: z.string().uuid().nullable().optional(),
  amountPaise: bigintStringSchema,
  gstPaise: bigintStringSchema.optional(),
  paymentMethod: PaymentMethodEnum.optional(),
  status: StatusEnum.optional(),
  referenceNumber: z.string().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type CreateOfficeExpenseInput = z.input<typeof CreateSchema>;

export async function createOfficeExpense(
  input: CreateOfficeExpenseInput,
): Promise<OfficeExpenseRow> {
  const ctx = await getActorContext();
  const parsed = CreateSchema.parse(input);

  if (parsed.category === 'reimbursement' && !parsed.employeeId) {
    throw new AppError(
      'validation',
      'A reimbursement must be linked to the employee who paid out of pocket.',
    );
  }

  // If a vendor from the directory is picked, ignore the free-text name —
  // the join in `listOfficeExpenses` always renders the live vendor row.
  const vendorIdFinal = parsed.vendorId ?? null;
  const vendorNameFinal = vendorIdFinal ? null : (parsed.vendorName ?? null);

  const [row] = await db
    .insert(officeExpenses)
    .values({
      expenseDate: parsed.expenseDate,
      category: parsed.category,
      description: parsed.description,
      vendorId: vendorIdFinal,
      vendorName: vendorNameFinal,
      employeeId: parsed.employeeId ?? null,
      amountPaise: parsed.amountPaise,
      gstPaise: parsed.gstPaise ?? 0n,
      paymentMethod: parsed.paymentMethod ?? 'bank',
      status: parsed.status ?? (parsed.category === 'reimbursement' ? 'pending' : 'approved'),
      referenceNumber: parsed.referenceNumber ?? null,
      notes: parsed.notes ?? null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning();
  if (!row) throw new AppError('internal', 'office expense insert returned no row');

  return hydrate(row);
}

const UpdateSchema = z.object({
  id: z.string().uuid(),
  expenseDate: z.string().regex(dateRegex).optional(),
  category: CategoryEnum.optional(),
  description: z.string().min(1).max(500).optional(),
  vendorId: z.string().uuid().nullable().optional(),
  vendorName: z.string().max(200).nullable().optional(),
  employeeId: z.string().uuid().nullable().optional(),
  amountPaise: bigintStringSchema.optional(),
  gstPaise: bigintStringSchema.optional(),
  paymentMethod: PaymentMethodEnum.optional(),
  status: StatusEnum.optional(),
  referenceNumber: z.string().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type UpdateOfficeExpenseInput = z.input<typeof UpdateSchema>;

export async function updateOfficeExpense(
  input: UpdateOfficeExpenseInput,
): Promise<OfficeExpenseRow> {
  const ctx = await getActorContext();
  const { id, ...rest } = UpdateSchema.parse(input);

  const patch: Record<string, unknown> = { updatedBy: ctx.userId };
  if (rest.expenseDate !== undefined) patch.expenseDate = rest.expenseDate;
  if (rest.category !== undefined) patch.category = rest.category;
  if (rest.description !== undefined) patch.description = rest.description;
  if (rest.vendorId !== undefined) {
    patch.vendorId = rest.vendorId;
    // Clear the free-text fallback whenever a directory vendor is set,
    // and let the caller send vendorName separately to clear it manually.
    if (rest.vendorId !== null && rest.vendorName === undefined) {
      patch.vendorName = null;
    }
  }
  if (rest.vendorName !== undefined) patch.vendorName = rest.vendorName;
  if (rest.employeeId !== undefined) patch.employeeId = rest.employeeId;
  if (rest.amountPaise !== undefined) patch.amountPaise = rest.amountPaise;
  if (rest.gstPaise !== undefined) patch.gstPaise = rest.gstPaise;
  if (rest.paymentMethod !== undefined) patch.paymentMethod = rest.paymentMethod;
  if (rest.status !== undefined) patch.status = rest.status;
  if (rest.referenceNumber !== undefined) patch.referenceNumber = rest.referenceNumber;
  if (rest.notes !== undefined) patch.notes = rest.notes;

  const [row] = await db
    .update(officeExpenses)
    .set(patch)
    .where(and(eq(officeExpenses.id, id), isNull(officeExpenses.deletedAt)))
    .returning();
  if (!row) throw new AppError('not_found', 'Office expense not found.');

  return hydrate(row);
}

export async function deleteOfficeExpense(args: { id: string }): Promise<void> {
  const ctx = await getActorContext();
  const parsed = z.object({ id: z.string().uuid() }).parse(args);

  const result = await db
    .update(officeExpenses)
    .set({ deletedAt: new Date(), updatedBy: ctx.userId })
    .where(and(eq(officeExpenses.id, parsed.id), isNull(officeExpenses.deletedAt)))
    .returning({ id: officeExpenses.id });
  if (result.length === 0) {
    throw new AppError('not_found', 'Office expense not found.');
  }
}

async function hydrate(row: typeof officeExpenses.$inferSelect): Promise<OfficeExpenseRow> {
  let employeeName: string | null = null;
  if (row.employeeId) {
    const [emp] = await db
      .select({ fullName: employees.fullName })
      .from(employees)
      .where(eq(employees.id, row.employeeId))
      .limit(1);
    employeeName = emp?.fullName ?? null;
  }
  let vendorDirectoryName: string | null = null;
  if (row.vendorId) {
    const [v] = await db
      .select({ name: vendors.name })
      .from(vendors)
      .where(eq(vendors.id, row.vendorId))
      .limit(1);
    vendorDirectoryName = v?.name ?? null;
  }
  return {
    id: row.id,
    expenseDate: row.expenseDate,
    category: row.category as OfficeExpenseCategory,
    description: row.description,
    vendorId: row.vendorId,
    vendorName: vendorDirectoryName ?? row.vendorName,
    employeeId: row.employeeId,
    employeeName,
    amountPaise: row.amountPaise,
    gstPaise: row.gstPaise,
    totalPaise: row.amountPaise + row.gstPaise,
    paymentMethod: row.paymentMethod as OfficeExpensePaymentMethod,
    status: row.status as OfficeExpenseStatus,
    referenceNumber: row.referenceNumber,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}
