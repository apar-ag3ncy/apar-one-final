'use server';

import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';

import { logActivity } from '@/lib/activity';
import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import {
  entityAddresses,
  entityBankAccounts,
  entityContacts,
  entityTaxIdentifiers,
  transactions,
  vendors,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { GSTIN_RE, IFSC_RE, PAN_RE, last4 } from '@/lib/validators';

/**
 * Vendor write actions. Mirrors clients.ts (SPEC-AMENDMENT-001 §2.1 / §2.4).
 *
 *   - archiveVendor / archiveVendors — soft-delete; admin / partner.
 *   - restoreVendor — partner only (capability `restore_vendor`).
 *   - hardDeleteVendor — partner only, refuses if any non-reversed transaction
 *     references the vendor via `paid_to_vendor_id`.
 */

const VendorIdSchema = z.string().uuid();

export async function archiveVendor(id: string): Promise<void> {
  await archiveVendors([id]);
}

export async function archiveVendors(ids: readonly string[]): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'archive_vendor');
  const parsed = ids.map((v) => VendorIdSchema.parse(v));
  if (parsed.length === 0) return;

  await db
    .update(vendors)
    .set({
      isArchived: true,
      archivedAt: new Date(),
      archivedBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .where(
      and(
        inArray(vendors.id, parsed as string[]),
        eq(vendors.isArchived, false),
        isNull(vendors.deletedAt),
      ),
    );

  for (const id of parsed) {
    await logAudit({
      actorId: ctx.userId,
      entityType: 'vendor',
      entityId: id,
      action: 'update',
      changes: { isArchived: { before: false, after: true } },
    });
    await logActivity({
      entityType: 'vendor',
      entityId: id,
      actorId: ctx.userId,
      kind: 'entity.archived',
      summary: 'Vendor archived',
    });
  }
}

export async function restoreVendor(id: string): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'restore_vendor');

  await db
    .update(vendors)
    .set({
      isArchived: false,
      archivedAt: null,
      archivedBy: null,
      updatedBy: ctx.userId,
    })
    .where(and(eq(vendors.id, id), isNull(vendors.deletedAt)));

  await logAudit({
    actorId: ctx.userId,
    entityType: 'vendor',
    entityId: id,
    action: 'update',
    changes: { isArchived: { before: true, after: false } },
  });
  await logActivity({
    entityType: 'vendor',
    entityId: id,
    actorId: ctx.userId,
    kind: 'entity.restored',
    summary: 'Vendor restored',
  });
}

/**
 * Partner-only hard delete. Refuses if any non-reversed transaction references
 * the vendor as `paid_to_vendor_id`. UI surfaces the count and tells the user
 * to reverse those transactions first or archive the vendor instead.
 */
export async function hardDeleteVendor(id: string): Promise<void> {
  const ctx = await getActorContext();
  if (ctx.role !== 'partner') {
    throw new AppError('forbidden', 'Hard delete of a vendor is restricted to the partner role.', {
      detail: { role: ctx.role },
    });
  }

  const refs = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.paidToVendorId, id), ne(transactions.status, 'reversed')))
    .limit(1);
  if (refs.length > 0) {
    throw new AppError(
      'conflict',
      'This vendor has non-reversed transactions referencing it. Reverse those first or archive the vendor instead.',
      { detail: { entity: 'vendor', id } },
    );
  }

  await db.delete(vendors).where(eq(vendors.id, id));

  await logAudit({
    actorId: ctx.userId,
    entityType: 'vendor',
    entityId: id,
    action: 'delete',
    changes: { hard_delete: true },
  });
  await logActivity({
    entityType: 'vendor',
    entityId: id,
    actorId: ctx.userId,
    kind: 'entity.hard_deleted',
    summary: 'Vendor hard-deleted',
  });
}

export async function hardDeleteVendors(ids: readonly string[]): Promise<{
  deleted: number;
  blocked: string[];
}> {
  const ctx = await getActorContext();
  if (ctx.role !== 'partner') {
    throw new AppError('forbidden', 'Hard delete of a vendor is restricted to the partner role.', {
      detail: { role: ctx.role },
    });
  }
  const parsed = ids.map((v) => VendorIdSchema.parse(v));
  if (parsed.length === 0) return { deleted: 0, blocked: [] };

  const refs = await db
    .select({ id: transactions.paidToVendorId })
    .from(transactions)
    .where(
      and(
        inArray(transactions.paidToVendorId, parsed as string[]),
        ne(transactions.status, 'reversed'),
      ),
    );
  const blockedSet = new Set<string>();
  for (const r of refs) {
    if (r.id) blockedSet.add(r.id);
  }
  const deletable = parsed.filter((id) => !blockedSet.has(id));
  if (deletable.length === 0) {
    return { deleted: 0, blocked: Array.from(blockedSet) };
  }

  await db.delete(vendors).where(inArray(vendors.id, deletable as string[]));

  for (const id of deletable) {
    await logAudit({
      actorId: ctx.userId,
      entityType: 'vendor',
      entityId: id,
      action: 'delete',
      changes: { hard_delete: true },
    });
    await logActivity({
      entityType: 'vendor',
      entityId: id,
      actorId: ctx.userId,
      kind: 'entity.hard_deleted',
      summary: 'Vendor hard-deleted',
    });
  }
  return { deleted: deletable.length, blocked: Array.from(blockedSet) };
}

/* -------------------------------------------------------------------------- */
/* createVendor — backs the dashboard /vendors/new wizard AND OS quick-create  */
/* -------------------------------------------------------------------------- */

const CreateVendorContactSchema = z
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

const CreateVendorBankSchema = z
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

const CreateVendorContractSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('signed'),
    uploadedFileName: z.string().trim().min(1),
    signedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Signed-on date must be YYYY-MM-DD'),
  }),
  z.object({
    kind: z.literal('pending'),
    reason: z.string().trim().min(1),
    expectedBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected-by date must be YYYY-MM-DD'),
  }),
  // Mirrors `contractStatusEnum` — 'waived' kept for legacy paths and the
  // OS quick-create which doesn't gather contract details upfront.
  z.object({ kind: z.literal('waived'), reason: z.string().trim().optional() }),
]);

const CreateVendorSchema = z.object({
  name: z.string().trim().min(1, 'Vendor name is required'),
  // Normalise to lowercase so it matches the VendorCategory enum the UI maps
  // back from (mapVendorCategory is case-sensitive; "Photographer" would
  // otherwise fall back to "other").
  category: z.string().trim().toLowerCase().max(80).optional(),
  primaryEmail: z.string().trim().max(200).optional(),
  primaryPhone: z.string().trim().max(40).optional(),
  pan: z.string().trim().toUpperCase().optional(),
  gstin: z.string().trim().toUpperCase().optional(),
  msme: z.string().trim().max(60).optional(),
  registeredAddress: z.string().trim().max(2000).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  notes: z.string().trim().max(2000).optional(),
  contacts: z.array(CreateVendorContactSchema).optional(),
  bank: CreateVendorBankSchema.optional(),
  contract: CreateVendorContractSchema.optional(),
});

export type CreateVendorInput = z.input<typeof CreateVendorSchema>;

export type CreateVendorResult =
  | { ok: true; id: string }
  | { ok: false; message: string; errors: Record<string, string> };

const STATE_CODE_FROM_GSTIN: Record<string, string> = {
  '01': 'JK',
  '02': 'HP',
  '03': 'PB',
  '04': 'CH',
  '05': 'UK',
  '06': 'HR',
  '07': 'DL',
  '08': 'RJ',
  '09': 'UP',
  '10': 'BR',
  '11': 'SK',
  '12': 'AR',
  '13': 'NL',
  '14': 'MN',
  '15': 'MZ',
  '16': 'TR',
  '17': 'ML',
  '18': 'AS',
  '19': 'WB',
  '20': 'JH',
  '21': 'OD',
  '22': 'CG',
  '23': 'MP',
  '24': 'GJ',
  '26': 'DN',
  '27': 'MH',
  '29': 'KA',
  '30': 'GA',
  '31': 'LD',
  '32': 'KL',
  '33': 'TN',
  '34': 'PY',
  '35': 'AN',
  '36': 'TG',
  '37': 'AP',
  '38': 'LA',
};

function stateFromGstin(gstin: string | undefined): string | null {
  if (!gstin || gstin.length < 2) return null;
  return STATE_CODE_FROM_GSTIN[gstin.slice(0, 2)] ?? null;
}

function zodErrorsToPathMap(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.');
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

/**
 * Create a vendor + its child contacts / banking / tax identifiers /
 * registered address in a single transaction. Contract gating mirrors
 * createClient (AUDIT-GAPS §1.3); the contract block is optional here
 * because the OS quick-create modal doesn't capture it and falls back
 * to `kind='waived'` for legacy parity.
 */
export async function createVendor(input: CreateVendorInput): Promise<CreateVendorResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'create_vendor');

  const parsed = CreateVendorSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Please fix the highlighted fields.',
      errors: zodErrorsToPathMap(parsed.error),
    };
  }
  const v = parsed.data;

  const fieldErrors: Record<string, string> = {};
  if (v.pan && !PAN_RE.test(v.pan)) {
    fieldErrors.pan = 'PAN must look like ABCDE1234F.';
  }
  if (v.gstin && !GSTIN_RE.test(v.gstin)) {
    fieldErrors.gstin = 'GSTIN must be 15 characters like 27ABCDE1234F1Z5.';
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

  try {
    const newId = await db.transaction(async (tx) => {
      const filenameNote =
        contract.kind === 'signed' ? `Signed contract on file: ${contract.uploadedFileName}` : null;
      const composedNotes =
        v.notes && filenameNote ? `${v.notes}\n${filenameNote}` : (v.notes ?? filenameNote);

      const [row] = await tx
        .insert(vendors)
        .values({
          name: v.name,
          category: v.category || null,
          gstin: v.gstin || null,
          pan: v.pan || null,
          msmeUdyam: v.msme || null,
          contractStatus: contract.kind,
          contractPendingReason: contract.kind === 'pending' ? contract.reason : null,
          contractPendingUntil: contract.kind === 'pending' ? contract.expectedBy : null,
          notes: composedNotes,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: vendors.id });

      if (!row) {
        throw new AppError('internal', 'Vendor insert returned no row.');
      }
      const vendorId = row.id;

      // POCs (optional) — plus an auto-row for the primary email/phone
      // when no explicit contact was supplied. Keeps the OS quick-create
      // useful without forcing an extra step.
      const contactInputs = v.contacts ?? [];
      const fallbackContact =
        contactInputs.length === 0 && (v.primaryEmail || v.primaryPhone)
          ? [
              {
                name: v.name,
                role: 'Primary' as const,
                email: v.primaryEmail || undefined,
                phone: v.primaryPhone || undefined,
                isPrimary: true,
              },
            ]
          : [];
      const allContacts = [...contactInputs, ...fallbackContact];
      if (allContacts.length > 0) {
        await tx.insert(entityContacts).values(
          allContacts.map((c, idx) => ({
            entityType: 'vendor' as const,
            entityId: vendorId,
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

      const taxRows: Array<typeof entityTaxIdentifiers.$inferInsert> = [];
      if (v.pan) {
        taxRows.push({
          entityType: 'vendor',
          entityId: vendorId,
          kind: 'pan',
          maskedValue: v.pan,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
      }
      if (v.gstin) {
        taxRows.push({
          entityType: 'vendor',
          entityId: vendorId,
          kind: 'gstin',
          maskedValue: v.gstin,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
      }
      if (v.msme) {
        taxRows.push({
          entityType: 'vendor',
          entityId: vendorId,
          kind: 'msme_udyam',
          maskedValue: v.msme,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
      }
      if (taxRows.length > 0) {
        await tx.insert(entityTaxIdentifiers).values(taxRows);
      }

      if (v.registeredAddress) {
        await tx.insert(entityAddresses).values({
          entityType: 'vendor',
          entityId: vendorId,
          kind: 'registered',
          line1: v.registeredAddress.slice(0, 250),
          city: '—',
          stateCode: stateFromGstin(v.gstin) ?? 'MH',
          country: 'IN',
          gstin: v.gstin || null,
          isPrimary: true,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
      }

      const b = v.bank ?? {};
      const bankFilled =
        (b.bankName ?? '') !== '' || (b.accountNumber ?? '') !== '' || (b.ifsc ?? '') !== '';
      if (bankFilled) {
        const acct = (b.accountNumber ?? '').replace(/\s+/g, '');
        await tx.insert(entityBankAccounts).values({
          entityType: 'vendor',
          entityId: vendorId,
          holderName: (b.holderName?.trim() || v.name).slice(0, 200),
          accountLast4: acct.length >= 4 ? last4(acct) : '0000',
          ifsc: (b.ifsc ?? '').toUpperCase(),
          bankName: b.bankName ?? '',
          accountType: 'current',
          isPrimary: true,
          vaultObjectKey: '',
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
      }

      return vendorId;
    });

    await logAudit({
      actorId: ctx.userId,
      entityType: 'vendor',
      entityId: newId,
      action: 'insert',
      changes: { name: { before: null, after: v.name } },
    });
    await logActivity({
      entityType: 'vendor',
      entityId: newId,
      actorId: ctx.userId,
      kind: 'entity.created',
      summary: `Vendor "${v.name}" created`,
    });

    return { ok: true, id: newId };
  } catch (e) {
    const message =
      e instanceof AppError
        ? e.message
        : e instanceof Error
          ? e.message
          : 'Could not create the vendor.';
    return { ok: false, message, errors: {} };
  }
}

/* -------------------------------------------------------------------------- */
/* updateVendor — backs the OS "Edit Vendor" modal                            */
/* -------------------------------------------------------------------------- */

const UpdateVendorSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'Vendor name is required').optional(),
  category: z.string().trim().toLowerCase().max(80).nullable().optional(),
  gstin: z.string().trim().toUpperCase().nullable().optional(),
  pan: z.string().trim().toUpperCase().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export type UpdateVendorInput = z.input<typeof UpdateVendorSchema>;

export type UpdateVendorResult =
  | { ok: true }
  | { ok: false; message: string; errors: Record<string, string> };

/**
 * Patch the parent `vendors` row. Polymorphic children (contacts /
 * addresses / banking) are out of scope here — the dashboard's deeper
 * editors handle those; this is the OS quick-edit modal's path.
 *
 * Format-check identifiers; refuse the update with a `name` field
 * error if a different active vendor already holds the same name
 * (case-insensitive), matching the `clients` pattern from PR #1.
 */
export async function updateVendor(input: UpdateVendorInput): Promise<UpdateVendorResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_vendor');

  const parsed = UpdateVendorSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (!errors[path]) errors[path] = issue.message;
    }
    return { ok: false, message: 'Please fix the highlighted fields.', errors };
  }
  const v = parsed.data;

  const fieldErrors: Record<string, string> = {};
  if (v.gstin && !GSTIN_RE.test(v.gstin)) {
    fieldErrors.gstin = 'GSTIN must be 15 characters like 27ABCDE1234F1Z5.';
  }
  if (v.pan && !PAN_RE.test(v.pan)) {
    fieldErrors.pan = 'PAN must look like ABCDE1234F.';
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, message: 'Please fix the highlighted fields.', errors: fieldErrors };
  }

  // Refuse a rename that would collide with another active vendor.
  if (v.name) {
    const dup = await db
      .select({ id: vendors.id })
      .from(vendors)
      .where(
        and(
          ne(vendors.id, v.id),
          eq(vendors.isArchived, false),
          isNull(vendors.deletedAt),
          eq(vendors.name, v.name),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      return {
        ok: false,
        message: `A vendor named "${v.name}" already exists.`,
        errors: { name: 'A vendor with this name already exists.' },
      };
    }
  }

  // Build the partial update. `null` clears the column; `undefined`
  // leaves it untouched. The form passes `undefined` for empty fields.
  const patch: Partial<typeof vendors.$inferInsert> = { updatedBy: ctx.userId };
  if (v.name !== undefined) patch.name = v.name;
  if (v.category !== undefined) patch.category = v.category;
  if (v.gstin !== undefined) patch.gstin = v.gstin;
  if (v.pan !== undefined) patch.pan = v.pan;
  if (v.notes !== undefined) patch.notes = v.notes;

  try {
    const result = await db
      .update(vendors)
      .set(patch)
      .where(and(eq(vendors.id, v.id), isNull(vendors.deletedAt)))
      .returning({ id: vendors.id });
    if (result.length === 0) {
      return { ok: false, message: 'Vendor not found.', errors: {} };
    }

    await logAudit({
      actorId: ctx.userId,
      entityType: 'vendor',
      entityId: v.id,
      action: 'update',
      changes: Object.fromEntries(
        Object.entries(patch)
          .filter(([k]) => k !== 'updatedBy')
          .map(([k, val]) => [k, { before: null, after: val }]),
      ),
    });
    await logActivity({
      entityType: 'vendor',
      entityId: v.id,
      actorId: ctx.userId,
      kind: 'entity.updated',
      summary: `Vendor "${v.name ?? v.id}" updated`,
    });

    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Could not update the vendor.',
      errors: {},
    };
  }
}
