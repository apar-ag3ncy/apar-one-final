'use server';

import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { logActivity } from '@/lib/activity';
import { db, type DbClient } from '@/lib/db/client';
import { entityBankAccounts } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability, type Capability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

export type BankAccountEntityType = 'client' | 'vendor' | 'employee' | 'project' | 'office';
export type BankAccountTypeDb = 'current' | 'savings' | 'od' | 'escrow';

const entityTypeSchema = z.enum(['client', 'vendor', 'employee', 'project', 'office']);
const accountTypeSchema = z.enum(['current', 'savings', 'od', 'escrow']);

/**
 * Vault discipline (AUDIT-GAPS §1.2): the row carries `accountLast4` +
 * `vaultObjectKey`. The plaintext account number lives in the encrypted
 * blob at `vaultObjectKey`; reveal goes through `lib/storage.ts:revealBank`.
 *
 * `accountLast4` is exactly four digits and is validated by the CHECK
 * constraint added in `drizzle/0003_entity_subgraph.sql:208`.
 */
const BankAccountInputSchema = z.object({
  entityType: entityTypeSchema,
  entityId: z.string().uuid(),
  holderName: z.string().min(1).max(200),
  accountLast4: z
    .string()
    .length(4)
    .regex(/^[0-9]{4}$/),
  ifsc: z
    .string()
    .min(11)
    .max(11)
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/),
  bankName: z.string().min(1).max(120),
  branch: z.string().max(120).optional().nullable(),
  accountType: accountTypeSchema,
  isPrimary: z.boolean().default(false),
  vaultObjectKey: z.string().min(1),
  notes: z.string().max(2000).optional().nullable(),
});

const BankAccountPatchSchema = z.object({
  holderName: z.string().min(1).max(200).optional(),
  accountLast4: z
    .string()
    .length(4)
    .regex(/^[0-9]{4}$/)
    .optional(),
  ifsc: z
    .string()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/)
    .optional(),
  bankName: z.string().min(1).max(120).optional(),
  branch: z.string().max(120).optional().nullable(),
  accountType: accountTypeSchema.optional(),
  isPrimary: z.boolean().optional(),
  vaultObjectKey: z.string().min(1).optional(),
  isVerified: z.boolean().optional(),
  verificationNotes: z.string().max(500).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export type BankAccountInput = z.infer<typeof BankAccountInputSchema>;
export type BankAccountPatch = z.infer<typeof BankAccountPatchSchema>;

export type BankAccountRow = {
  id: string;
  bankName: string;
  branch: string | null;
  holderName: string;
  accountLast4: string;
  ifsc: string;
  accountType: BankAccountTypeDb;
  isPrimary: boolean;
  isVerified: boolean;
  /** Vault pointer — never reveal to the client directly. */
  vaultObjectKey: string;
  notes: string | null;
};

function rowToBank(r: typeof entityBankAccounts.$inferSelect): BankAccountRow {
  return {
    id: r.id,
    bankName: r.bankName,
    branch: r.branch,
    holderName: r.holderName,
    accountLast4: r.accountLast4,
    ifsc: r.ifsc,
    accountType: r.accountType,
    isPrimary: r.isPrimary,
    isVerified: r.isVerified,
    vaultObjectKey: r.vaultObjectKey,
    notes: r.notes,
  };
}

function updateCapabilityFor(entityType: BankAccountEntityType): Capability {
  switch (entityType) {
    case 'client':
      return 'update_client';
    case 'vendor':
      return 'update_vendor';
    case 'employee':
      return 'update_employee';
    case 'project':
    case 'office':
      return 'update_client';
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listBankAccounts(args: {
  entityType: BankAccountEntityType;
  entityId: string;
  includeArchived?: boolean;
}): Promise<readonly BankAccountRow[]> {
  await getActorContext();
  const rows = await db
    .select()
    .from(entityBankAccounts)
    .where(
      and(
        eq(entityBankAccounts.entityType, args.entityType),
        eq(entityBankAccounts.entityId, args.entityId),
        args.includeArchived ? undefined : isNull(entityBankAccounts.deletedAt),
      ),
    )
    .orderBy(desc(entityBankAccounts.isPrimary), entityBankAccounts.bankName);
  return rows.map(rowToBank);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createBankAccount(input: BankAccountInput): Promise<BankAccountRow> {
  const ctx = await getActorContext();
  const parsed = BankAccountInputSchema.parse(input);
  requireCapability(ctx, updateCapabilityFor(parsed.entityType));

  return await db.transaction(async (tx) => {
    if (parsed.isPrimary) {
      // At most one primary bank account per entity.
      await tx
        .update(entityBankAccounts)
        .set({ isPrimary: false, updatedBy: ctx.userId })
        .where(
          and(
            eq(entityBankAccounts.entityType, parsed.entityType),
            eq(entityBankAccounts.entityId, parsed.entityId),
            eq(entityBankAccounts.isPrimary, true),
            isNull(entityBankAccounts.deletedAt),
          ),
        );
    }
    const [row] = await tx
      .insert(entityBankAccounts)
      .values({
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        holderName: parsed.holderName,
        accountLast4: parsed.accountLast4,
        ifsc: parsed.ifsc,
        bankName: parsed.bankName,
        branch: parsed.branch ?? null,
        accountType: parsed.accountType,
        isPrimary: parsed.isPrimary,
        vaultObjectKey: parsed.vaultObjectKey,
        notes: parsed.notes ?? null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    if (!row) throw new AppError('internal', 'entity_bank_accounts insert returned no row');

    await logActivity(
      {
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        actorId: ctx.userId,
        kind: 'bank.added',
        summary: `Added bank account at ${parsed.bankName} (****${parsed.accountLast4})`,
        payload: { bankAccountId: row.id, last4: parsed.accountLast4 },
      },
      tx as unknown as DbClient,
    );
    return rowToBank(row);
  });
}

export async function updateBankAccount(
  id: string,
  patch: BankAccountPatch,
): Promise<BankAccountRow> {
  const ctx = await getActorContext();
  const parsed = BankAccountPatchSchema.parse(patch);

  const existingRows = await db
    .select()
    .from(entityBankAccounts)
    .where(and(eq(entityBankAccounts.id, id), isNull(entityBankAccounts.deletedAt)))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) throw new AppError('not_found', `Bank account ${id} not found`);
  requireCapability(ctx, updateCapabilityFor(existing.entityType));

  return await db.transaction(async (tx) => {
    if (parsed.isPrimary === true) {
      await tx
        .update(entityBankAccounts)
        .set({ isPrimary: false, updatedBy: ctx.userId })
        .where(
          and(
            eq(entityBankAccounts.entityType, existing.entityType),
            eq(entityBankAccounts.entityId, existing.entityId),
            eq(entityBankAccounts.isPrimary, true),
            isNull(entityBankAccounts.deletedAt),
          ),
        );
    }
    const verifiedAt = parsed.isVerified === true ? new Date().toISOString() : existing.verifiedAt;
    const [row] = await tx
      .update(entityBankAccounts)
      .set({
        holderName: parsed.holderName ?? existing.holderName,
        accountLast4: parsed.accountLast4 ?? existing.accountLast4,
        ifsc: parsed.ifsc ?? existing.ifsc,
        bankName: parsed.bankName ?? existing.bankName,
        branch: parsed.branch === undefined ? existing.branch : parsed.branch,
        accountType: parsed.accountType ?? existing.accountType,
        isPrimary: parsed.isPrimary ?? existing.isPrimary,
        vaultObjectKey: parsed.vaultObjectKey ?? existing.vaultObjectKey,
        isVerified: parsed.isVerified ?? existing.isVerified,
        verifiedAt,
        verificationNotes:
          parsed.verificationNotes === undefined
            ? existing.verificationNotes
            : parsed.verificationNotes,
        notes: parsed.notes === undefined ? existing.notes : parsed.notes,
        updatedBy: ctx.userId,
      })
      .where(eq(entityBankAccounts.id, id))
      .returning();
    if (!row) throw new AppError('internal', 'entity_bank_accounts update returned no row');

    if (parsed.isVerified === true && existing.isVerified === false) {
      await logActivity(
        {
          entityType: existing.entityType,
          entityId: existing.entityId,
          actorId: ctx.userId,
          kind: 'bank.verified',
          summary: `Verified bank account at ${row.bankName}`,
          payload: { bankAccountId: id },
        },
        tx as unknown as DbClient,
      );
    }
    return rowToBank(row);
  });
}

export async function softDeleteBankAccount(id: string): Promise<void> {
  const ctx = await getActorContext();
  const existingRows = await db
    .select()
    .from(entityBankAccounts)
    .where(and(eq(entityBankAccounts.id, id), isNull(entityBankAccounts.deletedAt)))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) throw new AppError('not_found', `Bank account ${id} not found`);

  const isPartnerOrAdmin = ctx.role === 'partner' || ctx.role === 'admin';
  const isCreator = existing.createdBy === ctx.userId;
  if (!isPartnerOrAdmin && !isCreator) {
    requireCapability(ctx, updateCapabilityFor(existing.entityType));
  }

  await db
    .update(entityBankAccounts)
    .set({ deletedAt: new Date(), updatedBy: ctx.userId })
    .where(eq(entityBankAccounts.id, id));

  await logActivity({
    entityType: existing.entityType,
    entityId: existing.entityId,
    actorId: ctx.userId,
    kind: 'bank.removed',
    summary: `Removed bank account at ${existing.bankName}`,
    payload: { bankAccountId: id },
  });
}

export async function restoreBankAccount(id: string): Promise<BankAccountRow> {
  const ctx = await getActorContext();
  const existingRows = await db
    .select()
    .from(entityBankAccounts)
    .where(eq(entityBankAccounts.id, id))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) throw new AppError('not_found', `Bank account ${id} not found`);
  if (!existing.deletedAt) return rowToBank(existing);

  const isPartnerOrAdmin = ctx.role === 'partner' || ctx.role === 'admin';
  const isCreator = existing.createdBy === ctx.userId;
  if (!isPartnerOrAdmin && !isCreator) {
    requireCapability(ctx, updateCapabilityFor(existing.entityType));
  }

  const [row] = await db
    .update(entityBankAccounts)
    .set({ deletedAt: null, updatedBy: ctx.userId })
    .where(eq(entityBankAccounts.id, id))
    .returning();
  if (!row) throw new AppError('internal', 'entity_bank_accounts restore returned no row');
  return rowToBank(row);
}

export async function hardDeleteBankAccount(id: string): Promise<void> {
  const ctx = await getActorContext();
  if (ctx.role !== 'partner') {
    throw new AppError(
      'forbidden',
      'Hard delete of a bank account is restricted to the partner role.',
      { detail: { role: ctx.role } },
    );
  }
  await db.delete(entityBankAccounts).where(eq(entityBankAccounts.id, id));
}
