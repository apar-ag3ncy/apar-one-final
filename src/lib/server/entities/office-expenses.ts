'use server';

import { and, between, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import {
  accounts,
  documents,
  employees,
  officeExpenseCategories,
  officeExpenses,
  postings,
  vendors,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { createDraftTransaction, postTransaction, reverseTransaction } from '@/lib/server/ledger';
import { sniffMime } from '@/lib/storage';
import { createAdminClient } from '@/lib/supabase/server';

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
  /** FK to a user-defined sub-category; only meaningful when category='other'. */
  customCategoryId: string | null;
  /** Display name of the custom category, joined from office_expense_categories. */
  customCategoryName: string | null;
  /** Swatch colour of the custom category, joined from office_expense_categories. */
  customCategoryColor: string | null;
  /** Free-text note attached to the custom-category classification. */
  categoryNote: string | null;
  /** The posted GL journal this expense created; null when not posted (e.g. reimbursement). */
  transactionId: string | null;
  /** Whether this expense has posted to the ledger. */
  posted: boolean;
  /** FK to the attached bill/invoice in `documents`; null when none is attached. */
  documentId: string | null;
  /** Original filename of the attached invoice, joined from `documents`. */
  documentName: string | null;
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
      customCategoryId: officeExpenses.customCategoryId,
      customCategoryName: officeExpenseCategories.name,
      customCategoryColor: officeExpenseCategories.color,
      categoryNote: officeExpenses.categoryNote,
      transactionId: officeExpenses.transactionId,
      documentId: officeExpenses.documentId,
      documentName: documents.originalFilename,
      createdAt: officeExpenses.createdAt,
    })
    .from(officeExpenses)
    .leftJoin(employees, eq(employees.id, officeExpenses.employeeId))
    .leftJoin(vendors, eq(vendors.id, officeExpenses.vendorId))
    .leftJoin(
      officeExpenseCategories,
      eq(officeExpenseCategories.id, officeExpenses.customCategoryId),
    )
    .leftJoin(documents, eq(documents.id, officeExpenses.documentId))
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
      customCategoryId: r.customCategoryId,
      customCategoryName: r.customCategoryName,
      customCategoryColor: r.customCategoryColor,
      categoryNote: r.categoryNote,
      transactionId: r.transactionId,
      posted: !!r.transactionId,
      documentId: r.documentId,
      documentName: r.documentName,
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
  customByCategory: Array<{
    id: string;
    name: string;
    color: string | null;
    totalPaise: bigint;
    count: number;
  }>;
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

  const customByCategoryRows = await db
    .select({
      id: officeExpenseCategories.id,
      name: officeExpenseCategories.name,
      color: officeExpenseCategories.color,
      total: sql<string>`coalesce(sum(${officeExpenses.amountPaise} + ${officeExpenses.gstPaise}), 0)::text`,
      count: sql<string>`count(*)::text`,
    })
    .from(officeExpenses)
    .innerJoin(
      officeExpenseCategories,
      eq(officeExpenseCategories.id, officeExpenses.customCategoryId),
    )
    .where(
      and(
        isNull(officeExpenses.deletedAt),
        eq(officeExpenses.category, 'other'),
        sql`${officeExpenses.customCategoryId} is not null`,
        sql`${officeExpenses.expenseDate} >= ${fyStart}`,
      ),
    )
    .groupBy(officeExpenseCategories.id, officeExpenseCategories.name, officeExpenseCategories.color)
    .orderBy(officeExpenseCategories.name);

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
    customByCategory: customByCategoryRows.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
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

/* -------------------------------------------------------------------------- */
/* Ledger posting — office expenses auto-post to the GL on save.               */
/* -------------------------------------------------------------------------- */

// Office-expense category → operating-expense GL account (LEDGER-SPEC OpEx
// codes). Utilities/rent land in 6200 Office Rent & Utilities; everything else
// (incl. custom "other" buckets) in 6900 Other OpEx.
const OPEX_ACCOUNT_BY_CATEGORY: Partial<Record<OfficeExpenseCategory, string>> = {
  utilities: '6200',
  rent: '6200',
};
function opexAccountFor(category: OfficeExpenseCategory): string {
  return OPEX_ACCOUNT_BY_CATEGORY[category] ?? '6900';
}

/**
 * The debit side of an office-expense posting. Custom categories whose name
 * reads like an asset bucket ("Assets", "Fixed asset", …) CAPITALIZE — they
 * post to 1510 Office Equipment & Assets, which is exactly what the Accounts
 * Overview's "Stuff box" reads. Everything else stays operating spend.
 */
async function debitAccountFor(
  category: OfficeExpenseCategory,
  customCategoryId: string | null,
): Promise<string> {
  if (customCategoryId) {
    const [cat] = await db
      .select({ name: officeExpenseCategories.name })
      .from(officeExpenseCategories)
      .where(eq(officeExpenseCategories.id, customCategoryId))
      .limit(1);
    if (cat && /asset/i.test(cat.name)) return '1510';
    return '6900';
  }
  return opexAccountFor(category);
}

// Whether a captured expense should hit the GL. Reimbursements have their own
// lifecycle (owed to an employee, paid later) and are not posted here.
function shouldPostToLedger(category: OfficeExpenseCategory, amountPaise: bigint): boolean {
  return category !== 'reimbursement' && amountPaise > 0n;
}

type PostableRow = {
  id: string;
  category: OfficeExpenseCategory;
  /** Custom category id (office_expense_categories) — drives asset routing. */
  customCategoryId: string | null;
  description: string;
  expenseDate: string;
  amountPaise: bigint;
  gstPaise: bigint;
  notes: string | null;
};

// Post the expense as a balanced journal and return the posted transaction id.
//   Dr <6xxx OpEx>            net
//   Dr 1250 GST Input Credit  gst (if any)
//     Cr 1110 Cash on Hand    net + gst
// No ledger bank accounts exist yet, so every payment method credits cash.
async function postExpenseToLedger(
  ctx: Awaited<ReturnType<typeof getActorContext>>,
  row: PostableRow,
): Promise<string> {
  const net = row.amountPaise;
  const gst = row.gstPaise;
  const debitCode = await debitAccountFor(row.category, row.customCategoryId);
  const legs = [
    { accountCode: debitCode, side: 'debit' as const, amountPaise: net },
    ...(gst > 0n ? [{ accountCode: '1250', side: 'debit' as const, amountPaise: gst }] : []),
    { accountCode: '1110', side: 'credit' as const, amountPaise: net + gst },
  ];
  // The journal reason becomes transactions.description — the "Particulars"
  // column in the office-utilities ledger — so it must read exactly like the
  // expense's description in the Office app. journalReason requires ≥ 10
  // chars; suffix very short descriptions instead of blocking the save.
  const reason = row.description.trim();
  const draft = await createDraftTransaction(ctx, {
    kind: 'journal',
    input: {
      externalRef: `OFFEXP-${row.id}-${Date.now().toString(36)}`,
      txnDate: row.expenseDate,
      journalReason: (reason.length >= 10 ? reason : `${reason} — office expense`).slice(0, 480),
      legs,
      isOpeningBalance: false,
      notes: row.notes,
    },
  });
  await postTransaction(ctx, {
    transactionId: draft.transactionId,
    acknowledgedFlags: draft.validationFlags.map((f) => f.code),
  });
  return draft.transactionId;
}

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
  customCategoryId: z.string().uuid().nullable().optional(),
  categoryNote: z.string().max(200).nullable().optional(),
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
      // Stored as given — when set, the caller is expected to also send
      // category='other'; we don't override the category here.
      customCategoryId: parsed.customCategoryId ?? null,
      categoryNote: parsed.categoryNote ?? null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning();
  if (!row) throw new AppError('internal', 'office expense insert returned no row');

  await logAudit({
    actorId: ctx.userId,
    entityType: 'office_expense',
    entityId: row.id,
    action: 'insert',
    changes: {
      category: row.category,
      description: row.description,
      amountPaise: String(row.amountPaise),
      gstPaise: String(row.gstPaise),
      status: row.status,
    },
  });

  // Auto-post to the GL. If posting fails, roll the capture row back so the
  // create is atomic — no orphaned, unposted expense is left behind.
  let posted = row;
  if (shouldPostToLedger(row.category as OfficeExpenseCategory, row.amountPaise)) {
    let transactionId: string;
    try {
      transactionId = await postExpenseToLedger(ctx, {
        id: row.id,
        category: row.category as OfficeExpenseCategory,
        customCategoryId: row.customCategoryId ?? null,
        description: row.description,
        expenseDate: row.expenseDate,
        amountPaise: row.amountPaise,
        gstPaise: row.gstPaise,
        notes: row.notes,
      });
    } catch (e) {
      await db.delete(officeExpenses).where(eq(officeExpenses.id, row.id));
      throw e;
    }
    const [updated] = await db
      .update(officeExpenses)
      .set({ transactionId })
      .where(eq(officeExpenses.id, row.id))
      .returning();
    posted = updated ?? { ...row, transactionId };
  }

  return hydrate(posted);
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
  customCategoryId: z.string().uuid().nullable().optional(),
  categoryNote: z.string().max(200).nullable().optional(),
});

export type UpdateOfficeExpenseInput = z.input<typeof UpdateSchema>;

export async function updateOfficeExpense(
  input: UpdateOfficeExpenseInput,
): Promise<OfficeExpenseRow> {
  const ctx = await getActorContext();
  const { id, ...rest } = UpdateSchema.parse(input);

  const [existing] = await db
    .select()
    .from(officeExpenses)
    .where(and(eq(officeExpenses.id, id), isNull(officeExpenses.deletedAt)))
    .limit(1);
  if (!existing) throw new AppError('not_found', 'Office expense not found.');

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
  if (rest.customCategoryId !== undefined) patch.customCategoryId = rest.customCategoryId;
  if (rest.categoryNote !== undefined) patch.categoryNote = rest.categoryNote;

  const [row] = await db
    .update(officeExpenses)
    .set(patch)
    .where(and(eq(officeExpenses.id, id), isNull(officeExpenses.deletedAt)))
    .returning();
  if (!row) throw new AppError('not_found', 'Office expense not found.');

  // Keep the GL in sync. A financial change (amount / GST / category / date)
  // or a flip in post-eligibility (to/from reimbursement) reverses the old
  // posting and posts a fresh one. Non-financial edits (notes, reference,
  // vendor) leave the ledger untouched.
  const financialChanged =
    (rest.expenseDate !== undefined && rest.expenseDate !== existing.expenseDate) ||
    (rest.category !== undefined && rest.category !== existing.category) ||
    (rest.amountPaise !== undefined && rest.amountPaise !== existing.amountPaise) ||
    (rest.gstPaise !== undefined && rest.gstPaise !== existing.gstPaise) ||
    // A custom-category change can reroute the debit account (asset-named
    // categories post to 1510, the rest to 6900) — repost to keep the GL true.
    (rest.customCategoryId !== undefined && rest.customCategoryId !== existing.customCategoryId);
  const wasPosted = !!existing.transactionId;
  const willPost = shouldPostToLedger(row.category as OfficeExpenseCategory, row.amountPaise);
  let posted = row;
  const repost = financialChanged || wasPosted !== willPost;
  if (repost) {
    if (wasPosted && existing.transactionId) {
      await reverseTransaction(ctx, {
        transactionId: existing.transactionId,
        reason: `Office expense edited — ${existing.category}: ${existing.description}`.slice(0, 200),
      });
    }
    const nextTxnId = willPost
      ? await postExpenseToLedger(ctx, {
          id: row.id,
          category: row.category as OfficeExpenseCategory,
          customCategoryId: row.customCategoryId ?? null,
          description: row.description,
          expenseDate: row.expenseDate,
          amountPaise: row.amountPaise,
          gstPaise: row.gstPaise,
          notes: row.notes,
        })
      : null;
    const [reposted] = await db
      .update(officeExpenses)
      .set({ transactionId: nextTxnId })
      .where(eq(officeExpenses.id, row.id))
      .returning();
    posted = reposted ?? { ...row, transactionId: nextTxnId };
  }

  await logAudit({
    actorId: ctx.userId,
    entityType: 'office_expense',
    entityId: row.id,
    action: 'update',
    changes: { fields: Object.keys(rest), reposted: repost },
  });

  return hydrate(posted);
}

export async function deleteOfficeExpense(args: { id: string }): Promise<void> {
  const ctx = await getActorContext();
  const parsed = z.object({ id: z.string().uuid() }).parse(args);

  const [existing] = await db
    .select()
    .from(officeExpenses)
    .where(eq(officeExpenses.id, parsed.id))
    .limit(1);
  if (!existing) {
    throw new AppError('not_found', 'Office expense not found.');
  }

  // A posted expense can't be removed from the GL (postings are immutable) —
  // reverse its ledger entry first, then hard-delete the capture row.
  let reversed = false;
  if (existing.transactionId) {
    await reverseTransaction(ctx, {
      transactionId: existing.transactionId,
      reason: `Office expense deleted — ${existing.category}: ${existing.description}`.slice(0, 200),
    });
    reversed = true;
  }

  // Remove the attached invoice (if any) so a hard-deleted expense doesn't
  // orphan its document row + storage object. Capture the storage ref before
  // deleting the row; sweep the object best-effort after.
  let removedDocument = false;
  if (existing.documentId) {
    const [doc] = await db
      .select({ bucket: documents.bucket, storagePath: documents.storagePath })
      .from(documents)
      .where(eq(documents.id, existing.documentId))
      .limit(1);
    // Null the FK first (ON DELETE SET NULL would handle it, but the expense
    // row is about to go anyway), then delete the documents row.
    await db.delete(documents).where(eq(documents.id, existing.documentId));
    removedDocument = true;
    if (doc) {
      try {
        await createAdminClient().storage.from(doc.bucket).remove([doc.storagePath]);
      } catch {
        // best-effort — a failed storage sweep doesn't block the delete
      }
    }
  }

  // HARD delete — the row is removed from the database entirely; the audit
  // log below is the only remaining record of what was deleted.
  await db.delete(officeExpenses).where(eq(officeExpenses.id, parsed.id));

  await logAudit({
    actorId: ctx.userId,
    entityType: 'office_expense',
    entityId: parsed.id,
    action: 'delete',
    changes: {
      hard_delete: true,
      reversed,
      removedDocument,
      category: existing.category,
      description: existing.description,
      expenseDate: existing.expenseDate,
      amountPaise: String(existing.amountPaise),
      gstPaise: String(existing.gstPaise),
      paymentMethod: existing.paymentMethod,
      status: existing.status,
      transactionId: existing.transactionId,
    },
  });
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
  let customCategoryName: string | null = null;
  let customCategoryColor: string | null = null;
  if (row.customCategoryId) {
    const [c] = await db
      .select({ name: officeExpenseCategories.name, color: officeExpenseCategories.color })
      .from(officeExpenseCategories)
      .where(eq(officeExpenseCategories.id, row.customCategoryId))
      .limit(1);
    customCategoryName = c?.name ?? null;
    customCategoryColor = c?.color ?? null;
  }
  let documentName: string | null = null;
  if (row.documentId) {
    const [d] = await db
      .select({ originalFilename: documents.originalFilename })
      .from(documents)
      .where(eq(documents.id, row.documentId))
      .limit(1);
    documentName = d?.originalFilename ?? null;
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
    customCategoryId: row.customCategoryId,
    customCategoryName,
    customCategoryColor,
    categoryNote: row.categoryNote,
    transactionId: row.transactionId,
    posted: !!row.transactionId,
    documentId: row.documentId,
    documentName,
    createdAt: row.createdAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Invoice attachment — upload / remove the source bill for an expense         */
/* -------------------------------------------------------------------------- */

const MAX_INVOICE_BYTES = 25 * 1024 * 1024; // 25 MB (SPEC-AMENDMENT-001 §10.3)

/** Sanitise an uploaded filename for use inside a storage object key. */
function safeInvoiceFilename(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
}

/**
 * Attach (or replace) the source bill / invoice for an office expense.
 *
 * Pipeline mirrors {@link uploadDocument} but is scoped to a single office
 * expense: the file lands in `restricted-docs` under an `office_expense/…`
 * key, a `documents` row records the storage ref, and
 * `office_expenses.document_id` is repointed at it. Any previously attached
 * document is unlinked, its DB row deleted, and its storage object removed
 * best-effort so we don't accumulate orphans.
 *
 * `formData`: `expenseId` (uuid) + `file`. Capability `upload_document`.
 * 25 MB cap; magic-byte sniff rejects a proven MIME lie.
 */
export async function attachOfficeExpenseInvoice(
  formData: FormData,
): Promise<{ documentId: string; documentName: string }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'upload_document');

  const expenseId = z.string().uuid().parse(formData.get('expenseId'));

  const file = formData.get('file');
  if (!(file instanceof File)) {
    throw new AppError('validation', 'Missing or invalid file in upload payload.');
  }
  if (file.size === 0) {
    throw new AppError('validation', 'File is empty.');
  }
  if (file.size > MAX_INVOICE_BYTES) {
    throw new AppError(
      'storage.size_exceeded',
      `File exceeds ${Math.round(MAX_INVOICE_BYTES / 1024 / 1024)} MB limit.`,
    );
  }

  const [existing] = await db
    .select({ id: officeExpenses.id, documentId: officeExpenses.documentId })
    .from(officeExpenses)
    .where(and(eq(officeExpenses.id, expenseId), isNull(officeExpenses.deletedAt)))
    .limit(1);
  if (!existing) throw new AppError('not_found', 'Office expense not found.');

  // Capture the prior document's storage ref BEFORE we delete its row, so the
  // best-effort sweep after the transaction can remove the orphaned object.
  const priorDocumentId = existing.documentId;
  let priorStorage: { bucket: string; storagePath: string } | null = null;
  if (priorDocumentId) {
    const [priorDoc] = await db
      .select({ bucket: documents.bucket, storagePath: documents.storagePath })
      .from(documents)
      .where(eq(documents.id, priorDocumentId))
      .limit(1);
    if (priorDoc) priorStorage = { bucket: priorDoc.bucket, storagePath: priorDoc.storagePath };
  }

  // Magic-byte sniff. `sniffMime` returns the true type (or the browser's
  // declared type when the header isn't one we fingerprint).
  const headerBytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const effectiveMime = sniffMime(headerBytes, file.type || undefined);

  const bucket = 'restricted-docs' as const;
  const safeName = safeInvoiceFilename(file.name);
  const objectKey = `office_expense/${expenseId}/${crypto.randomUUID()}-${safeName}`;

  const admin = createAdminClient();
  const fileBuffer = new Uint8Array(await file.arrayBuffer());
  const { error: uploadError } = await admin.storage.from(bucket).upload(objectKey, fileBuffer, {
    contentType: effectiveMime,
    cacheControl: '300',
    upsert: false,
  });
  if (uploadError) {
    throw new AppError('internal', `Storage upload failed: ${uploadError.message}`);
  }

  // Insert the documents row + repoint the expense at it. Both run in one
  // transaction so a partial success can't leave the expense pointing at a
  // row that doesn't exist (or vice versa).
  const documentId = await db.transaction(async (tx) => {
    const [docRow] = await tx
      .insert(documents)
      .values({
        entityType: 'office_expense',
        entityId: expenseId,
        bucket,
        storagePath: objectKey,
        visibility: 'restricted',
        category: 'invoice',
        originalFilename: file.name,
        mimeType: effectiveMime,
        sizeBytes: file.size,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: documents.id });
    if (!docRow) throw new AppError('internal', 'documents insert returned no row');

    await tx
      .update(officeExpenses)
      .set({ documentId: docRow.id, updatedBy: ctx.userId })
      .where(eq(officeExpenses.id, expenseId));

    // Delete the prior document row (if any) now that nothing references it.
    if (priorDocumentId) {
      await tx.delete(documents).where(eq(documents.id, priorDocumentId));
    }

    return docRow.id;
  });

  // Best-effort removal of the superseded storage object — after the DB rows
  // are committed, so a failed sweep never dangles a live reference.
  if (priorStorage) {
    try {
      await admin.storage.from(priorStorage.bucket).remove([priorStorage.storagePath]);
    } catch {
      // best-effort
    }
  }

  await logAudit({
    actorId: ctx.userId,
    entityType: 'office_expense',
    entityId: expenseId,
    action: 'update',
    changes: {
      attach_invoice: true,
      documentId,
      replacedDocumentId: priorDocumentId,
      mime: effectiveMime,
      sizeBytes: file.size,
    },
  });

  return { documentId, documentName: file.name };
}

/**
 * Remove the attached invoice from an office expense: null the
 * `document_id`, delete the `documents` row, and best-effort remove the
 * storage object. Capability `delete_document`.
 */
export async function removeOfficeExpenseInvoice(input: { expenseId: string }): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'delete_document');
  const { expenseId } = z.object({ expenseId: z.string().uuid() }).parse(input);

  const [existing] = await db
    .select({ id: officeExpenses.id, documentId: officeExpenses.documentId })
    .from(officeExpenses)
    .where(eq(officeExpenses.id, expenseId))
    .limit(1);
  if (!existing) throw new AppError('not_found', 'Office expense not found.');
  if (!existing.documentId) {
    throw new AppError('not_found', 'This office expense has no attached invoice.');
  }

  // Read the storage ref before deleting the row so we can sweep the object.
  const [doc] = await db
    .select({ bucket: documents.bucket, storagePath: documents.storagePath })
    .from(documents)
    .where(eq(documents.id, existing.documentId))
    .limit(1);

  const documentId = existing.documentId;
  await db.transaction(async (tx) => {
    await tx
      .update(officeExpenses)
      .set({ documentId: null, updatedBy: ctx.userId })
      .where(eq(officeExpenses.id, expenseId));
    await tx.delete(documents).where(eq(documents.id, documentId));
  });

  // Remove the storage object only after the DB rows are gone (best-effort —
  // an orphaned object is acceptable; a dangling row is not).
  if (doc?.bucket && doc.storagePath) {
    try {
      const admin = createAdminClient();
      await admin.storage.from(doc.bucket).remove([doc.storagePath]);
    } catch {
      // best-effort
    }
  }

  await logAudit({
    actorId: ctx.userId,
    entityType: 'office_expense',
    entityId: expenseId,
    action: 'update',
    changes: { remove_invoice: true, documentId },
  });
}

/* -------------------------------------------------------------------------- */
/* Custom categories                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A user-defined sub-category for the catch-all `other` bucket. Lets the
 * office admin carve out their own recurring labels (e.g. "pooja", "gifts")
 * without touching the fixed {@link CategoryEnum}.
 */
export type OfficeExpenseCategoryRow = {
  id: string;
  name: string;
  color: string | null;
  hint: string | null;
  createdAt: string;
};

/** Active custom categories (not soft-deleted), ordered by name. */
export async function listOfficeExpenseCategories(): Promise<readonly OfficeExpenseCategoryRow[]> {
  await getActorContext();

  const rows = await db
    .select({
      id: officeExpenseCategories.id,
      name: officeExpenseCategories.name,
      color: officeExpenseCategories.color,
      hint: officeExpenseCategories.hint,
      createdAt: officeExpenseCategories.createdAt,
    })
    .from(officeExpenseCategories)
    .where(isNull(officeExpenseCategories.deletedAt))
    .orderBy(officeExpenseCategories.name);

  return rows.map(
    (r): OfficeExpenseCategoryRow => ({
      id: r.id,
      name: r.name,
      color: r.color,
      hint: r.hint,
      createdAt: r.createdAt.toISOString(),
    }),
  );
}

const CreateCategorySchema = z.object({
  name: z.string().min(1).max(120),
  color: z.string().max(32).nullable().optional(),
  hint: z.string().max(200).nullable().optional(),
});

export async function createOfficeExpenseCategory(input: {
  name: string;
  color?: string | null;
  hint?: string | null;
}): Promise<OfficeExpenseCategoryRow> {
  const ctx = await getActorContext();
  const parsed = CreateCategorySchema.parse(input);

  const name = parsed.name.trim();
  if (!name) {
    throw new AppError('validation', 'Category name is required.');
  }

  // Reject a case-insensitive duplicate among the active categories.
  const [dupe] = await db
    .select({ id: officeExpenseCategories.id })
    .from(officeExpenseCategories)
    .where(
      and(isNull(officeExpenseCategories.deletedAt), ilike(officeExpenseCategories.name, name)),
    )
    .limit(1);
  if (dupe) {
    throw new AppError('validation', `A category named "${name}" already exists.`);
  }

  const [row] = await db
    .insert(officeExpenseCategories)
    .values({
      name,
      color: parsed.color ?? null,
      hint: parsed.hint ?? null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning();
  if (!row) throw new AppError('internal', 'office expense category insert returned no row');

  await logAudit({
    actorId: ctx.userId,
    entityType: 'office_expense_category',
    entityId: row.id,
    action: 'insert',
    changes: { name: row.name, color: row.color, hint: row.hint },
  });

  return {
    id: row.id,
    name: row.name,
    color: row.color,
    hint: row.hint,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function deleteOfficeExpenseCategory(args: { id: string }): Promise<void> {
  const ctx = await getActorContext();
  const parsed = z.object({ id: z.string().uuid() }).parse(args);

  // A category still carrying entries cannot be deleted — the user must move
  // its expenses to another category first (bulk re-assign in the Office app).
  const [usage] = await db
    .select({ count: sql<string>`count(*)::text` })
    .from(officeExpenses)
    .where(
      and(eq(officeExpenses.customCategoryId, parsed.id), isNull(officeExpenses.deletedAt)),
    );
  const inUse = usage ? Number(usage.count) : 0;
  if (inUse > 0) {
    throw new AppError(
      'validation',
      `This category still has ${inUse} ${inUse === 1 ? 'entry' : 'entries'}. Move them to another category first, then delete it.`,
    );
  }

  const result = await db
    .update(officeExpenseCategories)
    .set({ deletedAt: new Date(), updatedBy: ctx.userId })
    .where(and(eq(officeExpenseCategories.id, parsed.id), isNull(officeExpenseCategories.deletedAt)))
    .returning({ id: officeExpenseCategories.id });
  if (result.length === 0) {
    throw new AppError('not_found', 'Office expense category not found.');
  }

  await logAudit({
    actorId: ctx.userId,
    entityType: 'office_expense_category',
    entityId: parsed.id,
    action: 'delete',
    changes: { soft_delete: true },
  });
}

/** How many live expenses still reference a custom category (all-time). */
export async function getOfficeExpenseCategoryUsage(args: {
  id: string;
}): Promise<{ activeCount: number }> {
  await getActorContext();
  const parsed = z.object({ id: z.string().uuid() }).parse(args);
  const [row] = await db
    .select({ count: sql<string>`count(*)::text` })
    .from(officeExpenses)
    .where(and(eq(officeExpenses.customCategoryId, parsed.id), isNull(officeExpenses.deletedAt)));
  return { activeCount: row ? Number(row.count) : 0 };
}

const ReassignSchema = z
  .object({
    fromCategoryId: z.string().uuid(),
    /** Move entries to another custom category… */
    toCustomCategoryId: z.string().uuid().nullable().optional(),
    /** …or to a built-in category (reimbursement excluded — different lifecycle). */
    toCategory: CategoryEnum.exclude(['reimbursement']).nullable().optional(),
  })
  .refine((v) => !!v.toCustomCategoryId !== !!v.toCategory, {
    message: 'Pick exactly one target: a custom category or a built-in one.',
  });

/**
 * Bulk re-assign: move every entry of one custom category to another category
 * (custom or built-in), reversing + reposting each posted entry whose debit
 * account changes. The OLD debit account is read from the entry's actual
 * posted transaction (not inferred from the category name) — entries edited
 * across categories before the customCategoryId repost fix can sit on a stale
 * account, and those are exactly the postings this must correct. Trashed
 * entries are re-pointed without ledger effect (their transactions were
 * already reversed). Per-row failures don't abort the batch — the counts
 * report what moved, what re-posted, and what failed.
 */
export async function reassignOfficeExpenseCategoryEntries(input: {
  fromCategoryId: string;
  toCustomCategoryId?: string | null;
  toCategory?: string | null;
}): Promise<{ moved: number; reposted: number; failed: number }> {
  const ctx = await getActorContext();
  const parsed = ReassignSchema.parse(input);

  if (parsed.toCustomCategoryId === parsed.fromCategoryId) {
    throw new AppError('validation', 'Pick a different category to move the entries to.');
  }

  const [fromCat] = await db
    .select({ id: officeExpenseCategories.id, name: officeExpenseCategories.name })
    .from(officeExpenseCategories)
    .where(eq(officeExpenseCategories.id, parsed.fromCategoryId))
    .limit(1);
  if (!fromCat) throw new AppError('not_found', 'Source category not found.');

  let toCatName: string | null = null;
  if (parsed.toCustomCategoryId) {
    const [toCat] = await db
      .select({ id: officeExpenseCategories.id, name: officeExpenseCategories.name })
      .from(officeExpenseCategories)
      .where(
        and(
          eq(officeExpenseCategories.id, parsed.toCustomCategoryId),
          isNull(officeExpenseCategories.deletedAt),
        ),
      )
      .limit(1);
    if (!toCat) throw new AppError('not_found', 'Target category not found.');
    toCatName = toCat.name;
  }

  const newDebit = parsed.toCustomCategoryId
    ? /asset/i.test(toCatName ?? '')
      ? '1510'
      : '6900'
    : opexAccountFor(parsed.toCategory as OfficeExpenseCategory);
  const nextCategory = (
    parsed.toCustomCategoryId ? 'other' : parsed.toCategory
  ) as OfficeExpenseCategory;
  const nextCustomId = parsed.toCustomCategoryId ?? null;

  const rows = await db
    .select()
    .from(officeExpenses)
    .where(eq(officeExpenses.customCategoryId, parsed.fromCategoryId));

  // Fail fast on capabilities if any live posted row may need a ledger move —
  // better a clean refusal than a half-moved batch (recordSalaryPayment's
  // orphan-draft rule).
  const anyPosted = rows.some((r) => r.deletedAt == null && r.transactionId);
  if (anyPosted) {
    requireCapability(ctx, 'reverse_transaction');
    requireCapability(ctx, 'post_transaction');
  }

  /** The debit account this expense's posted transaction ACTUALLY hit. */
  async function postedDebitAccount(transactionId: string): Promise<string | null> {
    const [leg] = await db
      .select({ code: accounts.code })
      .from(postings)
      .innerJoin(accounts, eq(accounts.id, postings.accountId))
      .where(
        and(
          eq(postings.transactionId, transactionId),
          eq(postings.side, 'debit'),
          sql`${accounts.code} <> '1250'`,
        ),
      )
      .limit(1);
    return leg?.code ?? null;
  }

  let moved = 0;
  let reposted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      let nextTxnId: string | null | undefined; // undefined → keep as is
      if (row.deletedAt == null && row.transactionId) {
        const oldDebit = await postedDebitAccount(row.transactionId);
        if (oldDebit !== null && oldDebit !== newDebit) {
          await reverseTransaction(ctx, {
            transactionId: row.transactionId,
            reason:
              `Category re-assigned — ${fromCat.name} → ${toCatName ?? nextCategory}: ${row.description}`.slice(
                0,
                200,
              ),
          });
          try {
            nextTxnId = await postExpenseToLedger(ctx, {
              id: row.id,
              category: nextCategory,
              customCategoryId: nextCustomId,
              description: row.description,
              expenseDate: row.expenseDate,
              amountPaise: row.amountPaise,
              gstPaise: row.gstPaise,
              notes: row.notes,
            });
            reposted += 1;
          } catch (e) {
            // Reversed but the fresh posting failed: leave the row UNPOSTED
            // (transactionId null) so the Office app's "Post N to ledger"
            // backfill can pick it up — never point a live row at a reversed
            // transaction.
            nextTxnId = null;
            console.error('[office-expenses] reassign repost failed:', row.id, e);
          }
        }
      }
      await db
        .update(officeExpenses)
        .set({
          category: nextCategory,
          customCategoryId: nextCustomId,
          updatedBy: ctx.userId,
          ...(nextTxnId !== undefined ? { transactionId: nextTxnId } : {}),
        })
        .where(eq(officeExpenses.id, row.id));
      if (row.deletedAt == null) moved += 1;
    } catch (e) {
      failed += 1;
      console.error('[office-expenses] reassign failed for row:', row.id, e);
    }
  }

  await logAudit({
    actorId: ctx.userId,
    entityType: 'office_expense_category',
    entityId: parsed.fromCategoryId,
    action: 'update',
    changes: {
      reassigned_to: parsed.toCustomCategoryId ?? parsed.toCategory,
      moved,
      reposted,
      failed,
    },
  });
  return { moved, reposted, failed };
}

/* -------------------------------------------------------------------------- */
/* Bulk import                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Human labels for the fixed {@link CategoryEnum} built-ins. Sourced from the
 * OS Office app's CATEGORY_DEFS. Used to resolve a free-text category name from
 * an imported sheet onto a built-in enum value before falling back to a custom
 * category. Keyed case-insensitively (see {@link resolveBuiltInCategory}).
 */
const BUILT_IN_CATEGORY_LABELS: Record<OfficeExpenseCategory, string> = {
  stationary: 'Stationary',
  toiletries: 'Toiletries',
  tea_coffee: 'Tea & Coffee',
  cleaning: 'Cleaning',
  leisure: 'Leisure',
  utilities: 'Utilities',
  rent: 'Rent',
  travel: 'Travel',
  repairs: 'Repairs',
  reimbursement: 'Reimbursement',
  other: 'Other',
};

/** Normalise a category string for case-insensitive matching. */
function normaliseCategoryKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

const BUILT_IN_CATEGORY_LOOKUP: ReadonlyMap<string, OfficeExpenseCategory> = (() => {
  const m = new Map<string, OfficeExpenseCategory>();
  for (const value of CategoryEnum.options) {
    // Match on the raw enum id ("tea_coffee") …
    m.set(normaliseCategoryKey(value), value);
    // … the id with underscores as spaces ("tea coffee") …
    m.set(normaliseCategoryKey(value.replace(/_/g, ' ')), value);
    // … and the human label ("Tea & Coffee").
    m.set(normaliseCategoryKey(BUILT_IN_CATEGORY_LABELS[value]), value);
  }
  return m;
})();

/** Returns the built-in enum value for a category name, or null if none. */
function resolveBuiltInCategory(raw: string): OfficeExpenseCategory | null {
  return BUILT_IN_CATEGORY_LOOKUP.get(normaliseCategoryKey(raw)) ?? null;
}

export type ImportOfficeExpenseRow = {
  expenseDate: string;
  description: string;
  categoryName?: string | null;
  amountPaise: bigint | string;
  gstPaise?: bigint | string;
  paymentMethod?: OfficeExpensePaymentMethod;
  referenceNumber?: string | null;
  notes?: string | null;
};

export type ImportOfficeExpensesResult = {
  inserted: number;
  categoriesCreated: number;
  errors: Array<{ row: number; message: string }>;
};

const ImportRowSchema = z.object({
  expenseDate: z.string().regex(dateRegex, 'expenseDate must be YYYY-MM-DD'),
  description: z.string().trim().min(1, 'description is required').max(500),
  categoryName: z.string().max(120).nullable().optional(),
  amountPaise: bigintStringSchema,
  gstPaise: bigintStringSchema.optional(),
  paymentMethod: PaymentMethodEnum.optional(),
  referenceNumber: z.string().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const ImportSchema = z.object({
  rows: z.array(z.unknown()).max(2000),
});

/**
 * Best-effort bulk import of office expenses from a parsed sheet. Each row is
 * validated + inserted independently: a bad row is recorded in `errors` and the
 * import continues. Category resolution:
 *   - a name matching a built-in ({@link CategoryEnum}) id or label uses that
 *     enum value with `customCategoryId=null`;
 *   - any other non-empty name find-or-creates a custom category (mirrors
 *     {@link createOfficeExpenseCategory}) and sets `category='other'` +
 *     `customCategoryId` + `categoryNote=<name>`;
 *   - a blank/absent name falls back to `'other'` with no custom category.
 */
export async function importOfficeExpenses(input: {
  rows: ImportOfficeExpenseRow[];
}): Promise<ImportOfficeExpensesResult> {
  const ctx = await getActorContext();
  const { rows } = ImportSchema.parse(input);

  const result: ImportOfficeExpensesResult = {
    inserted: 0,
    categoriesCreated: 0,
    errors: [],
  };

  // Cache resolved custom categories by normalised name within this import so
  // two rows with the same custom label reuse one category (and count once).
  const customCategoryCache = new Map<string, string>();

  for (let i = 0; i < rows.length; i++) {
    // `row` numbers are 1-based for a human reading the source sheet.
    const rowNo = i + 1;
    try {
      const parsed = ImportRowSchema.parse(rows[i]);

      let category: OfficeExpenseCategory = 'other';
      let customCategoryId: string | null = null;
      let categoryNote: string | null = null;

      const rawName = parsed.categoryName?.trim() ?? '';
      if (rawName) {
        const builtIn = resolveBuiltInCategory(rawName);
        if (builtIn) {
          category = builtIn;
        } else {
          category = 'other';
          categoryNote = rawName;
          const key = normaliseCategoryKey(rawName);
          const cached = customCategoryCache.get(key);
          if (cached) {
            customCategoryId = cached;
          } else {
            customCategoryId = await resolveOrCreateCustomCategory(rawName, ctx.userId, result);
            customCategoryCache.set(key, customCategoryId);
          }
        }
      }

      const [insertedRow] = await db
        .insert(officeExpenses)
        .values({
          expenseDate: parsed.expenseDate,
          category,
          description: parsed.description,
          vendorId: null,
          vendorName: null,
          employeeId: null,
          amountPaise: parsed.amountPaise,
          gstPaise: parsed.gstPaise ?? 0n,
          paymentMethod: parsed.paymentMethod ?? 'bank',
          status: category === 'reimbursement' ? 'pending' : 'approved',
          referenceNumber: parsed.referenceNumber ?? null,
          notes: parsed.notes ?? null,
          customCategoryId,
          categoryNote,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning();
      result.inserted += 1;

      // Auto-post to the GL (best-effort — a posting failure leaves the row
      // captured-but-unposted and is surfaced as a warning, not a hard error,
      // so one bad date/period doesn't abort the whole import).
      if (insertedRow && shouldPostToLedger(category, insertedRow.amountPaise)) {
        try {
          const txnId = await postExpenseToLedger(ctx, {
            id: insertedRow.id,
            category,
            customCategoryId: insertedRow.customCategoryId ?? null,
            description: insertedRow.description,
            expenseDate: insertedRow.expenseDate,
            amountPaise: insertedRow.amountPaise,
            gstPaise: insertedRow.gstPaise,
            notes: insertedRow.notes,
          });
          await db
            .update(officeExpenses)
            .set({ transactionId: txnId })
            .where(eq(officeExpenses.id, insertedRow.id));
        } catch (postErr) {
          result.errors.push({
            row: rowNo,
            message: `saved but not posted to ledger: ${postErr instanceof Error ? postErr.message : 'unknown error'}`,
          });
        }
      }
    } catch (err) {
      const message =
        err instanceof z.ZodError
          ? err.issues.map((e) => `${e.path.join('.') || 'row'}: ${e.message}`).join('; ')
          : err instanceof AppError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Unknown error';
      result.errors.push({ row: rowNo, message });
    }
  }

  await logAudit({
    actorId: ctx.userId,
    entityType: 'office_expense',
    entityId: '00000000-0000-0000-0000-000000000000',
    action: 'insert',
    changes: {
      bulk_import: true,
      inserted: result.inserted,
      categoriesCreated: result.categoriesCreated,
      errorCount: result.errors.length,
    },
  });

  return result;
}

/**
 * Find (case-insensitive, among active) or create a custom category. Mirrors
 * {@link createOfficeExpenseCategory}'s dedupe rule; increments
 * `result.categoriesCreated` when a new row is inserted.
 */
async function resolveOrCreateCustomCategory(
  rawName: string,
  userId: string,
  result: ImportOfficeExpensesResult,
): Promise<string> {
  const name = rawName.trim();
  const [existing] = await db
    .select({ id: officeExpenseCategories.id })
    .from(officeExpenseCategories)
    .where(and(isNull(officeExpenseCategories.deletedAt), ilike(officeExpenseCategories.name, name)))
    .limit(1);
  if (existing) return existing.id;

  const [row] = await db
    .insert(officeExpenseCategories)
    .values({
      name,
      color: null,
      hint: null,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning({ id: officeExpenseCategories.id });
  if (!row) throw new AppError('internal', 'office expense category insert returned no row');

  result.categoriesCreated += 1;
  return row.id;
}

/* -------------------------------------------------------------------------- */
/* Trash — restore / permanent delete                                          */
/* -------------------------------------------------------------------------- */

export async function restoreOfficeExpense(input: { id: string }): Promise<void> {
  const ctx = await getActorContext();
  const parsed = z.object({ id: z.string().uuid() }).parse(input);

  const result = await db
    .update(officeExpenses)
    .set({ deletedAt: null, updatedBy: ctx.userId })
    .where(and(eq(officeExpenses.id, parsed.id), sql`${officeExpenses.deletedAt} is not null`))
    .returning({ id: officeExpenses.id });
  if (result.length === 0) {
    throw new AppError('not_found', 'Office expense not found or not deleted.');
  }

  await logAudit({
    actorId: ctx.userId,
    entityType: 'office_expense',
    entityId: parsed.id,
    action: 'update',
    changes: { restore: true },
  });
}

export async function permanentlyDeleteOfficeExpense(input: { id: string }): Promise<void> {
  const ctx = await getActorContext();
  const parsed = z.object({ id: z.string().uuid() }).parse(input);

  // Only purge rows that are already soft-deleted (in the trash).
  const result = await db
    .delete(officeExpenses)
    .where(and(eq(officeExpenses.id, parsed.id), sql`${officeExpenses.deletedAt} is not null`))
    .returning({ id: officeExpenses.id });
  if (result.length === 0) {
    throw new AppError('not_found', 'Office expense not found in trash.');
  }

  await logAudit({
    actorId: ctx.userId,
    entityType: 'office_expense',
    entityId: parsed.id,
    action: 'delete',
    changes: { permanent: true },
  });
}

export async function restoreOfficeExpenseCategory(input: { id: string }): Promise<void> {
  const ctx = await getActorContext();
  const parsed = z.object({ id: z.string().uuid() }).parse(input);

  const result = await db
    .update(officeExpenseCategories)
    .set({ deletedAt: null, updatedBy: ctx.userId })
    .where(
      and(
        eq(officeExpenseCategories.id, parsed.id),
        sql`${officeExpenseCategories.deletedAt} is not null`,
      ),
    )
    .returning({ id: officeExpenseCategories.id });
  if (result.length === 0) {
    throw new AppError('not_found', 'Office expense category not found or not deleted.');
  }

  await logAudit({
    actorId: ctx.userId,
    entityType: 'office_expense_category',
    entityId: parsed.id,
    action: 'update',
    changes: { restore: true },
  });
}

export async function permanentlyDeleteOfficeExpenseCategory(input: { id: string }): Promise<void> {
  const ctx = await getActorContext();
  const parsed = z.object({ id: z.string().uuid() }).parse(input);

  const result = await db
    .delete(officeExpenseCategories)
    .where(
      and(
        eq(officeExpenseCategories.id, parsed.id),
        sql`${officeExpenseCategories.deletedAt} is not null`,
      ),
    )
    .returning({ id: officeExpenseCategories.id });
  if (result.length === 0) {
    throw new AppError('not_found', 'Office expense category not found in trash.');
  }

  await logAudit({
    actorId: ctx.userId,
    entityType: 'office_expense_category',
    entityId: parsed.id,
    action: 'delete',
    changes: { permanent: true },
  });
}

/* -------------------------------------------------------------------------- */
/* Backfill — post historical (pre-ledger) office expenses to the GL           */
/* -------------------------------------------------------------------------- */

/** How many captured expenses are eligible to post but haven't yet. */
export async function countUnpostedOfficeExpenses(): Promise<number> {
  await getActorContext();
  const [agg] = await db
    .select({ n: sql<string>`count(*)::text` })
    .from(officeExpenses)
    .where(
      and(
        isNull(officeExpenses.deletedAt),
        isNull(officeExpenses.transactionId),
        sql`${officeExpenses.category} <> 'reimbursement'`,
        sql`${officeExpenses.amountPaise} > 0`,
      ),
    );
  return Number(agg?.n ?? '0');
}

export type BackfillLedgerResult = {
  posted: number;
  skipped: number;
  errors: Array<{ id: string; message: string }>;
};

/**
 * One-shot (repeatable) backfill: post every eligible office expense that
 * isn't linked to the ledger yet (legacy capture-only rows + any import that
 * failed to post). Best-effort per row — a failure (e.g. no period covers the
 * date) is skipped and recorded, never aborts the batch. Safe to re-run: it
 * only touches rows with a null transaction_id.
 */
export async function backfillOfficeExpenseLedgerPostings(input?: {
  limit?: number;
}): Promise<BackfillLedgerResult> {
  const ctx = await getActorContext();
  // Posting is sequential (one journal per expense) and slow, so the caller
  // processes a small batch per request and loops — keeping each request well
  // under the serverless function timeout. Rows that fail keep a null
  // transaction_id and fall out once they're all that's left (posted === 0).
  const limit = Math.min(Math.max(input?.limit ?? 5, 1), 25);
  const rows = await db
    .select()
    .from(officeExpenses)
    .where(
      and(
        isNull(officeExpenses.deletedAt),
        isNull(officeExpenses.transactionId),
        sql`${officeExpenses.category} <> 'reimbursement'`,
        sql`${officeExpenses.amountPaise} > 0`,
      ),
    )
    .orderBy(officeExpenses.expenseDate)
    .limit(limit);

  const result: BackfillLedgerResult = { posted: 0, skipped: 0, errors: [] };
  for (const row of rows) {
    try {
      const txnId = await postExpenseToLedger(ctx, {
        id: row.id,
        category: row.category as OfficeExpenseCategory,
        customCategoryId: row.customCategoryId ?? null,
        description: row.description,
        expenseDate: row.expenseDate,
        amountPaise: row.amountPaise,
        gstPaise: row.gstPaise,
        notes: row.notes,
      });
      await db
        .update(officeExpenses)
        .set({ transactionId: txnId })
        .where(eq(officeExpenses.id, row.id));
      result.posted += 1;
    } catch (e) {
      result.skipped += 1;
      result.errors.push({ id: row.id, message: e instanceof Error ? e.message : 'unknown error' });
    }
  }

  await logAudit({
    actorId: ctx.userId,
    entityType: 'office_expense',
    entityId: '00000000-0000-0000-0000-000000000000',
    action: 'update',
    changes: { backfill_ledger: true, posted: result.posted, skipped: result.skipped },
  });

  return result;
}
