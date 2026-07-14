'use server';

import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logActivity } from '@/lib/activity';
import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import {
  employees,
  entityAddresses,
  entityBankAccounts,
  entityContacts,
  entityTaxIdentifiers,
  salaryLines,
  salaryStructures,
  transactions,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { ensureDepartmentRegistered } from '@/lib/server/entities/department-registry';
import { IFSC_RE, PAN_RE, last4, maskAadhaar, maskPAN } from '@/lib/validators';

/**
 * Employee write actions. Mirrors clients.ts and vendors.ts.
 *
 *   - archive / restore via capability gates.
 *   - Hard delete (partner only) refuses if any non-reversed transaction
 *     references the employee as `incurred_by_employee_id`, OR if any
 *     `salary_lines` reference the employee. Salary history is statutory —
 *     never let it dangle off a deleted employee row.
 */

const EmployeeIdSchema = z.string().uuid();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function archiveEmployee(id: string): Promise<void> {
  await archiveEmployees([id]);
}

export async function archiveEmployees(ids: readonly string[]): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'archive_employee');
  const parsed = ids.map((v) => EmployeeIdSchema.parse(v));
  if (parsed.length === 0) return;

  await db
    .update(employees)
    .set({
      isArchived: true,
      archivedAt: new Date(),
      archivedBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .where(
      and(
        inArray(employees.id, parsed as string[]),
        eq(employees.isArchived, false),
        isNull(employees.deletedAt),
      ),
    );

  for (const id of parsed) {
    await logAudit({
      actorId: ctx.userId,
      entityType: 'employee',
      entityId: id,
      action: 'update',
      changes: { isArchived: { before: false, after: true } },
    });
    await logActivity({
      entityType: 'employee',
      entityId: id,
      actorId: ctx.userId,
      kind: 'entity.archived',
      summary: 'Employee archived',
    });
  }
}

export async function restoreEmployee(id: string): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'restore_employee');

  await db
    .update(employees)
    .set({
      isArchived: false,
      archivedAt: null,
      archivedBy: null,
      updatedBy: ctx.userId,
    })
    .where(and(eq(employees.id, id), isNull(employees.deletedAt)));

  await logAudit({
    actorId: ctx.userId,
    entityType: 'employee',
    entityId: id,
    action: 'update',
    changes: { isArchived: { before: true, after: false } },
  });
  await logActivity({
    entityType: 'employee',
    entityId: id,
    actorId: ctx.userId,
    kind: 'entity.restored',
    summary: 'Employee restored',
  });
}

async function employeeBlockers(ids: readonly string[]): Promise<Set<string>> {
  const blocked = new Set<string>();
  // Non-reversed transactions referencing the employee.
  const txnRefs = await db
    .select({ id: transactions.incurredByEmployeeId })
    .from(transactions)
    .where(
      and(
        inArray(transactions.incurredByEmployeeId, ids as string[]),
        ne(transactions.status, 'reversed'),
      ),
    );
  for (const r of txnRefs) {
    if (r.id) blocked.add(r.id);
  }
  // Any salary_lines for the employee — payroll history is statutory.
  const slRefs = await db
    .select({ id: salaryLines.employeeId })
    .from(salaryLines)
    .where(inArray(salaryLines.employeeId, ids as string[]));
  for (const r of slRefs) {
    if (r.id) blocked.add(r.id);
  }
  return blocked;
}

export async function hardDeleteEmployee(id: string): Promise<void> {
  const ctx = await getActorContext();
  if (ctx.role !== 'partner') {
    throw new AppError(
      'forbidden',
      'Hard delete of an employee is restricted to the partner role.',
      { detail: { role: ctx.role } },
    );
  }

  const blocked = await employeeBlockers([id]);
  if (blocked.has(id)) {
    throw new AppError(
      'conflict',
      'This employee has non-reversed transactions or salary history. Reverse those first or archive the employee instead.',
      { detail: { entity: 'employee', id } },
    );
  }

  await db.delete(employees).where(eq(employees.id, id));

  await logAudit({
    actorId: ctx.userId,
    entityType: 'employee',
    entityId: id,
    action: 'delete',
    changes: { hard_delete: true },
  });
  await logActivity({
    entityType: 'employee',
    entityId: id,
    actorId: ctx.userId,
    kind: 'entity.hard_deleted',
    summary: 'Employee hard-deleted',
  });
}

export async function hardDeleteEmployees(ids: readonly string[]): Promise<{
  deleted: number;
  blocked: string[];
}> {
  const ctx = await getActorContext();
  if (ctx.role !== 'partner') {
    throw new AppError(
      'forbidden',
      'Hard delete of an employee is restricted to the partner role.',
      { detail: { role: ctx.role } },
    );
  }
  const parsed = ids.map((v) => EmployeeIdSchema.parse(v));
  if (parsed.length === 0) return { deleted: 0, blocked: [] };

  const blockedSet = await employeeBlockers(parsed);
  const deletable = parsed.filter((id) => !blockedSet.has(id));
  if (deletable.length === 0) {
    return { deleted: 0, blocked: Array.from(blockedSet) };
  }

  await db.delete(employees).where(inArray(employees.id, deletable as string[]));

  for (const id of deletable) {
    await logAudit({
      actorId: ctx.userId,
      entityType: 'employee',
      entityId: id,
      action: 'delete',
      changes: { hard_delete: true },
    });
    await logActivity({
      entityType: 'employee',
      entityId: id,
      actorId: ctx.userId,
      kind: 'entity.hard_deleted',
      summary: 'Employee hard-deleted',
    });
  }
  return { deleted: deletable.length, blocked: Array.from(blockedSet) };
}

/* -------------------------------------------------------------------------- */
/* createEmployee — backs the 7-step EmployeeWizard at /employees/new          */
/* -------------------------------------------------------------------------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const CreateEmployeeContactSchema = z
  .object({
    name: z.string().trim().min(1),
    role: z.string().trim().max(120).optional(),
    email: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(40).optional(),
    isPrimary: z.boolean().optional(),
  })
  .refine((c) => (c.email && c.email.length > 0) || (c.phone && c.phone.length > 0), {
    message: 'Each contact needs at least one of email or phone.',
    path: ['email'],
  });

const CreateEmployeeBankSchema = z
  .object({
    bankName: z.string().trim().max(200).optional(),
    accountNumber: z.string().trim().max(60).optional(),
    ifsc: z.string().trim().max(20).optional(),
    holderName: z.string().trim().max(200).optional(),
  })
  .refine(
    (b) => {
      const any =
        (b.bankName ?? '') !== '' ||
        (b.accountNumber ?? '') !== '' ||
        (b.ifsc ?? '') !== '' ||
        (b.holderName ?? '') !== '';
      if (!any) return true;
      return Boolean(b.bankName && b.accountNumber && b.ifsc);
    },
    {
      message: 'Bank name, account number and IFSC are required when adding a bank account.',
      path: ['bankName'],
    },
  )
  .refine((b) => !b.ifsc || IFSC_RE.test(b.ifsc.toUpperCase()), {
    message: 'IFSC format looks off — expected 4 letters + 0 + 6 alphanumerics.',
    path: ['ifsc'],
  });

// Salary is CAPTURED from the offer letter, never computed (CLAUDE rule #2).
// Amounts arrive as integer paise.
const CreateEmployeeSalarySchema = z.object({
  effectiveFrom: z.string().regex(ISO_DATE).optional(),
  basicPaise: z.number().int().nonnegative().optional(),
  hraPaise: z.number().int().nonnegative().optional(),
  specialAllowancePaise: z.number().int().nonnegative().optional(),
  ctcMonthlyPaise: z.number().int().nonnegative().optional(),
  notes: z.string().trim().max(2000).optional(),
});

const CreateEmployeeContractSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('signed'),
    uploadedFileName: z.string().trim().min(1),
    signedAt: z.string().regex(ISO_DATE, 'Signed-on date must be YYYY-MM-DD'),
  }),
  z.object({
    kind: z.literal('pending'),
    reason: z.string().trim().min(1),
    expectedBy: z.string().regex(ISO_DATE, 'Expected-by date must be YYYY-MM-DD'),
  }),
  z.object({ kind: z.literal('waived'), reason: z.string().trim().optional() }),
]);

const CreateEmployeeSchema = z.object({
  // Identity
  fullName: z.string().trim().min(1, 'Full name is required'),
  displayName: z.string().trim().max(120).optional(),
  employeeCode: z.string().trim().max(40).optional(), // auto-generated when blank
  workEmail: z.string().trim().max(200).optional(),
  personalEmail: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  // Employment
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'intern', 'consultant']),
  status: z.enum(['prospective', 'active', 'on_leave', 'notice', 'separated']).optional(),
  designation: z.string().trim().max(160).optional(),
  // Departments are dynamic free-text; normalise to lowercase so the picker
  // list dedups ("Creative" / "creative") and display title-cases uniformly.
  department: z.string().trim().toLowerCase().max(120).optional(),
  reportsToEmployeeId: z.string().uuid().optional(),
  joinedOn: z.string().regex(ISO_DATE, 'Joining date must be YYYY-MM-DD'),
  dateOfBirth: z.string().regex(ISO_DATE).nullable().optional(),
  confirmedOn: z.string().regex(ISO_DATE).optional(),
  separatedOn: z.string().regex(ISO_DATE).optional(),
  noticePeriodDays: z.string().trim().max(40).optional(),
  // KYC — masked on row, full lives only in the restricted-kyc scan
  pan: z.string().trim().toUpperCase().optional(),
  aadhaar: z.string().trim().optional(),
  // Address / contacts / banking / salary
  registeredAddress: z.string().trim().max(2000).optional(),
  contacts: z.array(CreateEmployeeContactSchema).optional(),
  bank: CreateEmployeeBankSchema.optional(),
  salary: CreateEmployeeSalarySchema.optional(),
  contract: CreateEmployeeContractSchema.optional(),
  notes: z.string().trim().max(2000).optional(),
});

export type CreateEmployeeInput = z.input<typeof CreateEmployeeSchema>;

export type CreateEmployeeResult =
  | { ok: true; id: string }
  | { ok: false; message: string; errors: Record<string, string> };

function zodErrorsToPathMap(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.');
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

/**
 * Generate the next `APAR-NNN` employee code by scanning existing codes.
 * Best-effort + monotonic; the unique constraint is the real guard, so a
 * race just surfaces as a friendly "code already in use" on insert.
 */
async function nextEmployeeCode(): Promise<string> {
  const rows = await db
    .select({ code: employees.employeeCode })
    .from(employees)
    .where(sql`${employees.employeeCode} ~ '^APAR-[0-9]+$'`)
    .orderBy(desc(employees.employeeCode));
  let max = 0;
  for (const r of rows) {
    const m = /^APAR-(\d+)$/.exec(r.code);
    if (m) max = Math.max(max, Number.parseInt(m[1]!, 10));
  }
  return `APAR-${String(max + 1).padStart(3, '0')}`;
}

const hasSalary = (s: NonNullable<z.infer<typeof CreateEmployeeSalarySchema>>): boolean =>
  Boolean(
    (s.basicPaise ?? 0) ||
    (s.hraPaise ?? 0) ||
    (s.specialAllowancePaise ?? 0) ||
    (s.ctcMonthlyPaise ?? 0),
  );

/**
 * Create an employee + child contacts / KYC tax-identifiers / address /
 * banking / initial salary structure in one transaction. Mirrors
 * `createClient` / `createVendor`.
 *
 * DPDP discipline (CLAUDE rules #26–#28): PAN/Aadhaar are masked on the
 * `employees` row and the `entity_tax_identifiers` row; the full value is
 * never persisted in clear here. The full identity scan (if any) is filed
 * separately via `uploadKycDocument` into the `restricted-kyc` bucket after
 * the row exists.
 *
 * Contract gating mirrors the other principals; `waived` is accepted for
 * the OS quick-create path.
 */
export async function createEmployee(input: CreateEmployeeInput): Promise<CreateEmployeeResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'create_employee');

  const parsed = CreateEmployeeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Please fix the highlighted fields.',
      errors: zodErrorsToPathMap(parsed.error),
    };
  }
  const v = parsed.data;

  const fieldErrors: Record<string, string> = {};
  const workEmail = (v.workEmail ?? '').trim();
  const personalEmail = (v.personalEmail ?? '').trim();
  const normalizedWorkEmail = workEmail ? workEmail.toLowerCase() : null;
  const normalizedPersonalEmail = personalEmail ? personalEmail.toLowerCase() : null;
  if (workEmail && !EMAIL_RE.test(workEmail)) {
    fieldErrors.workEmail = 'Enter a valid work email.';
  }
  if (personalEmail && !EMAIL_RE.test(personalEmail)) {
    fieldErrors.personalEmail = 'Enter a valid personal email.';
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, message: 'Please fix the highlighted fields.', errors: fieldErrors };
  }

  if (normalizedWorkEmail) {
    const dup = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(isNull(employees.deletedAt), eq(employees.workEmail, normalizedWorkEmail)))
      .limit(1);
    if (dup.length > 0) {
      return {
        ok: false,
        message: 'That work email is already in use.',
        errors: { workEmail: 'Already used by another employee.' },
      };
    }
  }

  // KYC format checks + masking. We compute the mask and discard the full
  // value — it must never be persisted in clear (CLAUDE rule #28).
  let maskedPan: string | null = null;
  let maskedAadhaar: string | null = null;
  if (v.pan) {
    if (!PAN_RE.test(v.pan)) {
      fieldErrors.pan = 'PAN must look like ABCDE1234F.';
    } else {
      maskedPan = maskPAN(v.pan);
    }
  }
  if (v.aadhaar) {
    const digits = v.aadhaar.replace(/\s+/g, '');
    if (!/^\d{12}$/.test(digits)) {
      fieldErrors.aadhaar = 'Aadhaar must be 12 digits.';
    } else {
      maskedAadhaar = maskAadhaar(digits);
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, message: 'Please fix the highlighted fields.', errors: fieldErrors };
  }

  const contract = v.contract ?? { kind: 'waived' as const };
  if (contract.kind === 'pending') {
    const today = new Date().toISOString().slice(0, 10);
    const limit = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (contract.expectedBy < today) {
      return {
        ok: false,
        message: 'Pending contracts need a future expected-by date.',
        errors: { 'contract.expectedBy': 'Date must be in the future.' },
      };
    }
    if (contract.expectedBy > limit) {
      return {
        ok: false,
        message: 'Pending contracts must be expected within 30 days.',
        errors: { 'contract.expectedBy': 'Pick a date within 30 days.' },
      };
    }
  }

  const employeeCode =
    v.employeeCode && v.employeeCode.length > 0 ? v.employeeCode : await nextEmployeeCode();

  try {
    const newId = await db.transaction(async (tx) => {
      const filenameNote =
        contract.kind === 'signed'
          ? `Signed offer/contract on file: ${contract.uploadedFileName}`
          : null;
      const composedNotes =
        v.notes && filenameNote ? `${v.notes}\n${filenameNote}` : (v.notes ?? filenameNote);

      const [row] = await tx
        .insert(employees)
        .values({
          employeeCode,
          fullName: v.fullName,
          displayName: v.displayName || null,
          workEmail: normalizedWorkEmail,
          personalEmail: normalizedPersonalEmail,
          phone: v.phone || null,
          employmentType: v.employmentType,
          status: v.status ?? 'active',
          designation: v.designation || null,
          department: v.department || null,
          reportsToEmployeeId: v.reportsToEmployeeId || null,
          joinedOn: v.joinedOn,
          dateOfBirth: v.dateOfBirth ?? null,
          confirmedOn: v.confirmedOn || null,
          separatedOn: v.separatedOn || null,
          noticePeriodDays: v.noticePeriodDays || null,
          maskedPan,
          maskedAadhaar,
          contractStatus: contract.kind,
          contractPendingReason: contract.kind === 'pending' ? contract.reason : null,
          contractPendingUntil: contract.kind === 'pending' ? contract.expectedBy : null,
          notes: composedNotes,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: employees.id });
      if (!row) throw new AppError('internal', 'Employee insert returned no row.');
      const employeeId = row.id;

      // Contacts (emergency / personal POCs) — optional.
      const contacts = v.contacts ?? [];
      if (contacts.length > 0) {
        await tx.insert(entityContacts).values(
          contacts.map((c, idx) => ({
            entityType: 'employee' as const,
            entityId: employeeId,
            name: c.name,
            role: c.role || null,
            email: c.email || null,
            phone: c.phone || null,
            isPrimary: c.isPrimary ?? idx === 0,
            createdBy: ctx.userId,
            updatedBy: ctx.userId,
          })),
        );
      }

      // KYC tax identifiers — masked on row; full value is only in the
      // restricted-kyc scan. Aadhaar is employee-only + vault-only.
      const taxRows: Array<typeof entityTaxIdentifiers.$inferInsert> = [];
      if (maskedPan) {
        taxRows.push({
          entityType: 'employee',
          entityId: employeeId,
          kind: 'pan',
          maskedValue: maskedPan,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
      }
      if (maskedAadhaar) {
        taxRows.push({
          entityType: 'employee',
          entityId: employeeId,
          kind: 'aadhaar',
          maskedValue: maskedAadhaar,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
      }
      if (taxRows.length > 0) {
        await tx.insert(entityTaxIdentifiers).values(taxRows);
      }

      // Registered/home address — optional.
      if (v.registeredAddress) {
        await tx.insert(entityAddresses).values({
          entityType: 'employee',
          entityId: employeeId,
          kind: 'registered',
          line1: v.registeredAddress.slice(0, 250),
          city: '—',
          stateCode: 'MH',
          country: 'IN',
          isPrimary: true,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
      }

      // Banking (salary account) — optional. Full number lands in the vault
      // later; we store last-4 + IFSC + holder.
      const b = v.bank ?? {};
      const bankFilled =
        (b.bankName ?? '') !== '' || (b.accountNumber ?? '') !== '' || (b.ifsc ?? '') !== '';
      if (bankFilled) {
        const acct = (b.accountNumber ?? '').replace(/\s+/g, '');
        await tx.insert(entityBankAccounts).values({
          entityType: 'employee',
          entityId: employeeId,
          holderName: (b.holderName?.trim() || v.fullName).slice(0, 200),
          accountLast4: acct.length >= 4 ? last4(acct) : '0000',
          ifsc: (b.ifsc ?? '').toUpperCase(),
          bankName: b.bankName ?? '',
          accountType: 'savings',
          isPrimary: true,
          vaultObjectKey: '',
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
      }

      // Initial salary structure — captured from the offer letter, optional.
      if (v.salary && hasSalary(v.salary)) {
        await tx.insert(salaryStructures).values({
          employeeId,
          effectiveFrom: v.salary.effectiveFrom || v.joinedOn,
          basicPaise: BigInt(v.salary.basicPaise ?? 0),
          hraPaise: BigInt(v.salary.hraPaise ?? 0),
          specialAllowancePaise: BigInt(v.salary.specialAllowancePaise ?? 0),
          ctcMonthlyPaise: BigInt(v.salary.ctcMonthlyPaise ?? 0),
          notes: v.salary.notes || null,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
      }

      return employeeId;
    });

    await logAudit({
      actorId: ctx.userId,
      entityType: 'employee',
      entityId: newId,
      action: 'insert',
      changes: { fullName: { before: null, after: v.fullName }, employeeCode },
    });
    await logActivity({
      entityType: 'employee',
      entityId: newId,
      actorId: ctx.userId,
      kind: 'entity.created',
      summary: `Employee "${v.fullName}" (${employeeCode}) created`,
    });

    // Keep the managed department registry complete when a new one is typed.
    await ensureDepartmentRegistered(v.department, ctx.userId);

    return { ok: true, id: newId };
  } catch (e) {
    // Unique violation on employee_code surfaces as a friendly field error.
    const raw = e instanceof Error ? e.message : '';
    if (/employee_code/i.test(raw) || /unique/i.test(raw)) {
      return {
        ok: false,
        message: 'That employee code is already in use.',
        errors: { employeeCode: 'Already in use — pick another or leave blank to auto-generate.' },
      };
    }
    const message =
      e instanceof AppError
        ? e.message
        : e instanceof Error
          ? e.message
          : 'Could not create the employee.';
    return { ok: false, message, errors: {} };
  }
}

/* -------------------------------------------------------------------------- */
/* updateEmployee — backs the OS "Edit teammate" modal + dashboard Edit        */
/* -------------------------------------------------------------------------- */

const UpdateEmployeeSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string().trim().min(1, 'Full name is required').optional(),
  displayName: z.string().trim().max(120).nullable().optional(),
  workEmail: z.string().trim().max(200).nullable().optional(),
  personalEmail: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  designation: z.string().trim().max(160).nullable().optional(),
  department: z.string().trim().toLowerCase().max(120).nullable().optional(),
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'intern', 'consultant']).optional(),
  status: z.enum(['prospective', 'active', 'on_leave', 'notice', 'separated']).optional(),
  reportsToEmployeeId: z.string().uuid().nullable().optional(),
  // Lifecycle dates. joinedOn is NOT NULL in the DB, so it can be corrected
  // but not cleared; confirmedOn / separatedOn are nullable.
  joinedOn: z.string().regex(ISO_DATE, 'Joining date must be YYYY-MM-DD').optional(),
  dateOfBirth: z.string().regex(ISO_DATE, 'Date of birth must be YYYY-MM-DD').nullable().optional(),
  confirmedOn: z
    .string()
    .regex(ISO_DATE, 'Confirmation date must be YYYY-MM-DD')
    .nullable()
    .optional(),
  separatedOn: z
    .string()
    .regex(ISO_DATE, 'Separation date must be YYYY-MM-DD')
    .nullable()
    .optional(),
  noticePeriodDays: z.string().trim().max(40).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export type UpdateEmployeeInput = z.input<typeof UpdateEmployeeSchema>;

export type UpdateEmployeeResult =
  | { ok: true }
  | { ok: false; message: string; errors: Record<string, string> };

/**
 * Patch the parent `employees` row. Polymorphic children (contacts /
 * addresses / banking / tax identifiers / salary) are out of scope here —
 * the profile window's deeper editors own those. This backs the OS
 * "Edit teammate" quick-edit modal and the dashboard detail Edit dialog.
 *
 * Mirrors `updateVendor`: `null` clears a column, `undefined` leaves it
 * untouched. `work_email` is unique, so a colliding value surfaces as a
 * friendly field error rather than a 500. KYC masks, `employee_code`, and
 * archive lifecycle are deliberately NOT editable here — those have their
 * own gated paths (createEmployee / archiveEmployee / KYC reveal).
 */
export async function updateEmployee(input: UpdateEmployeeInput): Promise<UpdateEmployeeResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_employee');

  const parsed = UpdateEmployeeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Please fix the highlighted fields.',
      errors: zodErrorsToPathMap(parsed.error),
    };
  }
  const v = parsed.data;

  // An employee cannot report to themselves.
  if (v.reportsToEmployeeId && v.reportsToEmployeeId === v.id) {
    return {
      ok: false,
      message: 'An employee cannot report to themselves.',
      errors: { reportsToEmployeeId: 'Pick a different manager.' },
    };
  }

  // Normalise the work email. Empty string clears it (NULL); a non-empty
  // value is lower-cased and format-checked. `undefined` leaves it untouched.
  const fieldErrors: Record<string, string> = {};
  let workEmailPatch: string | null | undefined;
  if (v.workEmail !== undefined) {
    const trimmed = (v.workEmail ?? '').trim();
    if (trimmed.length === 0) {
      workEmailPatch = null;
    } else if (!EMAIL_RE.test(trimmed)) {
      fieldErrors.workEmail = 'Enter a valid work email.';
    } else {
      workEmailPatch = trimmed.toLowerCase();
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, message: 'Please fix the highlighted fields.', errors: fieldErrors };
  }

  // Refuse a work-email change that collides with another (non-deleted) employee.
  if (typeof workEmailPatch === 'string') {
    const dup = await db
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          ne(employees.id, v.id),
          isNull(employees.deletedAt),
          eq(employees.workEmail, workEmailPatch),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      return {
        ok: false,
        message: 'That work email is already in use.',
        errors: { workEmail: 'Already used by another employee.' },
      };
    }
  }

  // Build the partial update. `null` clears the column; `undefined` leaves it.
  const patch: Partial<typeof employees.$inferInsert> = { updatedBy: ctx.userId };
  if (v.fullName !== undefined) patch.fullName = v.fullName;
  if (v.displayName !== undefined) patch.displayName = v.displayName;
  if (workEmailPatch !== undefined) patch.workEmail = workEmailPatch;
  if (v.personalEmail !== undefined) patch.personalEmail = v.personalEmail;
  if (v.phone !== undefined) patch.phone = v.phone;
  if (v.designation !== undefined) patch.designation = v.designation;
  if (v.department !== undefined) patch.department = v.department;
  if (v.employmentType !== undefined) patch.employmentType = v.employmentType;
  if (v.status !== undefined) patch.status = v.status;
  if (v.reportsToEmployeeId !== undefined) patch.reportsToEmployeeId = v.reportsToEmployeeId;
  if (v.joinedOn !== undefined) patch.joinedOn = v.joinedOn;
  if (v.dateOfBirth !== undefined) patch.dateOfBirth = v.dateOfBirth;
  if (v.confirmedOn !== undefined) patch.confirmedOn = v.confirmedOn;
  if (v.separatedOn !== undefined) patch.separatedOn = v.separatedOn;
  if (v.noticePeriodDays !== undefined) patch.noticePeriodDays = v.noticePeriodDays;
  if (v.notes !== undefined) patch.notes = v.notes;

  try {
    const result = await db
      .update(employees)
      .set(patch)
      .where(and(eq(employees.id, v.id), isNull(employees.deletedAt)))
      .returning({ id: employees.id, fullName: employees.fullName });
    if (result.length === 0) {
      return { ok: false, message: 'Employee not found.', errors: {} };
    }

    await logAudit({
      actorId: ctx.userId,
      entityType: 'employee',
      entityId: v.id,
      action: 'update',
      changes: Object.fromEntries(
        Object.entries(patch)
          .filter(([k]) => k !== 'updatedBy')
          .map(([k, val]) => [k, { before: null, after: val }]),
      ),
    });
    await logActivity({
      entityType: 'employee',
      entityId: v.id,
      actorId: ctx.userId,
      kind: 'entity.updated',
      summary: `Employee "${result[0]!.fullName}" updated`,
    });

    // Keep the managed department registry complete when a new one is typed.
    if (v.department !== undefined) await ensureDepartmentRegistered(v.department, ctx.userId);

    return { ok: true };
  } catch (e) {
    const raw = e instanceof Error ? e.message : '';
    if (/work_email/i.test(raw) || /unique/i.test(raw)) {
      return {
        ok: false,
        message: 'That work email is already in use.',
        errors: { workEmail: 'Already used by another employee.' },
      };
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Could not update the employee.',
      errors: {},
    };
  }
}

/* -------------------------------------------------------------------------- */
/* getEmployeeEditable — full editable field set for the OS profile editor     */
/* -------------------------------------------------------------------------- */

export type EditableEmployee = {
  id: string;
  fullName: string;
  displayName: string | null;
  designation: string | null;
  department: string | null;
  employmentType: 'full_time' | 'part_time' | 'contract' | 'intern' | 'consultant';
  status: 'prospective' | 'active' | 'on_leave' | 'notice' | 'separated';
  workEmail: string | null;
  personalEmail: string | null;
  phone: string | null;
  reportsToEmployeeId: string | null;
  joinedOn: string;
  dateOfBirth: string | null;
  confirmedOn: string | null;
  separatedOn: string | null;
  noticePeriodDays: string | null;
  notes: string | null;
};

/** Every field the OS profile editor needs to prefill + round-trip. */
export async function getEmployeeEditable(id: string): Promise<EditableEmployee | null> {
  await getActorContext();
  const rows = await db
    .select({
      id: employees.id,
      fullName: employees.fullName,
      displayName: employees.displayName,
      designation: employees.designation,
      department: employees.department,
      employmentType: employees.employmentType,
      status: employees.status,
      workEmail: employees.workEmail,
      personalEmail: employees.personalEmail,
      phone: employees.phone,
      reportsToEmployeeId: employees.reportsToEmployeeId,
      joinedOn: employees.joinedOn,
      dateOfBirth: employees.dateOfBirth,
      confirmedOn: employees.confirmedOn,
      separatedOn: employees.separatedOn,
      noticePeriodDays: employees.noticePeriodDays,
      notes: employees.notes,
    })
    .from(employees)
    .where(and(eq(employees.id, id), isNull(employees.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function importEmployees(inputs: CreateEmployeeInput[]): Promise<{
  successCount: number;
  errors: Array<{ index: number; name: string; message: string }>;
}> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'create_employee');

  let successCount = 0;
  const errors: Array<{ index: number; name: string; message: string }> = [];

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!;
    const res = await createEmployee(input);
    if (res.ok) {
      successCount++;
    } else {
      errors.push({ index: i, name: input.fullName, message: res.message });
    }
  }

  return { successCount, errors };
}
