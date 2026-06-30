'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import { accounts, bankAccounts, postings, transactions, users } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { createDraftTransaction, postTransaction } from '@/lib/server/ledger/transactions';
import { removeVaultObject, storeBank } from '@/lib/storage';

/**
 * Management of the agency's OWN bank accounts — the `bank_accounts` table,
 * the sub-ledger for GL account `1120 Bank Accounts`. These are the accounts
 * client receipts land into and vendor payments leave from; the row id is what
 * `recordManualReceipt` / `recordVendorPayment` carry as `bankAccountId`.
 *
 * Opening balance is POSTED into the double-entry ledger so the books tally:
 * `Dr 1120 (this account) / Cr 3100 Partner Capital`, dated the as-of date, via
 * the existing `partner_capital` transaction kind. A negative opening (overdraft)
 * posts the mirror `partner_drawing`. The full account number is vaulted exactly
 * like client/vendor accounts (only last-4 + the object key sit on the row).
 *
 * Distinct from `company_bank_accounts` (the block printed on invoice PDFs) and
 * `entity_bank_accounts` (clients'/vendors' banks).
 */

const BANKING_PATH = '/banking';
const BANK_GL_CODE = '1120';
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export type ActionResult = { ok: true } | { ok: false; message: string };
export type CreateBankAccountResult =
  | { ok: true; id: string; openingPosted: boolean; openingWarning?: string }
  | { ok: false; message: string };

function norm(s: string | null | undefined): string | null {
  const t = (s ?? '').trim();
  return t === '' ? null : t;
}

function toErr(e: unknown): { ok: false; message: string } {
  if (e instanceof AppError) return { ok: false, message: e.message };
  console.error('[banking/agency-accounts] action error:', e);
  return { ok: false, message: 'Something went wrong. Please try again.' };
}

const accountTypeSchema = z.enum(['current', 'savings', 'od', 'escrow']);
export type AgencyBankAccountType = z.infer<typeof accountTypeSchema>;

const BankAccountInput = z.object({
  displayName: z.string().trim().min(1, 'A label is required.').max(120),
  bankName: z.string().trim().min(1, 'Bank name is required.').max(120),
  branch: z.string().trim().max(160).nullish(),
  accountNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{4,20}$/, 'Account number must be 4–20 digits.'),
  ifsc: z.string().trim().min(1, 'IFSC is required.').max(20),
  accountType: accountTypeSchema,
  /** Opening balance in paise; positive = cash in the account, negative = overdraft. */
  openingBalancePaise: z.bigint(),
  openingBalanceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  notes: z.string().trim().max(1000).nullish(),
});
export type BankAccountInputShape = z.input<typeof BankAccountInput>;

const BankAccountPatch = z.object({
  displayName: z.string().trim().min(1, 'A label is required.').max(120),
  bankName: z.string().trim().min(1, 'Bank name is required.').max(120),
  branch: z.string().trim().max(160).nullish(),
  ifsc: z.string().trim().min(1, 'IFSC is required.').max(20),
  accountType: accountTypeSchema,
  isActive: z.boolean(),
  notes: z.string().trim().max(1000).nullish(),
});
export type BankAccountPatchShape = z.input<typeof BankAccountPatch>;

export type AgencyBankAccountDetail = {
  id: string;
  displayName: string;
  bankName: string;
  branch: string | null;
  accountLast4: string;
  ifsc: string;
  accountType: AgencyBankAccountType;
  openingBalancePaise: bigint;
  openingBalanceDate: string | null;
  isActive: boolean;
  notes: string | null;
  /** Current balance from the ledger (includes the posted opening balance). */
  currentBalancePaise: bigint;
};

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Lists the agency bank accounts with each one's current ledger balance
 * (opening balance + every posted movement on its 1120 sub-ledger). Active
 * accounts float to the top.
 */
export async function listAgencyBankAccountsDetailed(): Promise<AgencyBankAccountDetail[]> {
  await getActorContext();
  const rows = await db
    .select({
      id: bankAccounts.id,
      displayName: bankAccounts.displayName,
      bankName: bankAccounts.bankName,
      branch: bankAccounts.branch,
      accountLast4: bankAccounts.accountLast4,
      ifsc: bankAccounts.ifsc,
      accountType: bankAccounts.accountType,
      openingBalancePaise: bankAccounts.openingBalancePaise,
      openingBalanceDate: bankAccounts.openingBalanceDate,
      isActive: bankAccounts.isActive,
      notes: bankAccounts.notes,
    })
    .from(bankAccounts)
    .orderBy(desc(bankAccounts.isActive), asc(bankAccounts.displayName));

  // One pass over the 1120 postings → balance per bank account. Asset
  // convention: debit adds, credit subtracts. Reversed transactions excluded
  // (they pair with their original).
  const balRows = await db
    .select({
      bankId: postings.subledgerEntityId,
      balancePaise: sql<string>`COALESCE(SUM(CASE WHEN ${postings.side} = 'debit' THEN ${postings.amountPaise} ELSE -${postings.amountPaise} END), 0)`,
    })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(and(eq(accounts.code, BANK_GL_CODE), ne(transactions.status, 'reversed')))
    .groupBy(postings.subledgerEntityId);
  const balMap = new Map(balRows.map((r) => [r.bankId, BigInt(r.balancePaise)]));

  return rows.map((r) => ({
    ...r,
    currentBalancePaise: balMap.get(r.id) ?? 0n,
  }));
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The partner the opening capital is attributed to (3100 is sub-ledgered by
 * partner_user_id). Single-partner agencies have exactly one; if there are
 * several we pick the earliest-created. Returns null when no partner user
 * exists — the caller then posts the opening balance against 3900 Opening
 * Balance Equity (a non-control account) instead, so it still posts and tallies.
 */
async function resolvePartnerUserId(): Promise<string | null> {
  const [partner] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'partner'), isNull(users.deletedAt)))
    .orderBy(asc(users.createdAt))
    .limit(1);
  return partner?.id ?? null;
}

export async function createAgencyBankAccount(
  input: BankAccountInputShape,
): Promise<CreateBankAccountResult> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'manage_bank_accounts');
    const v = BankAccountInput.parse(input);
    const ifsc = v.ifsc.toUpperCase();
    if (!IFSC_RE.test(ifsc)) {
      return { ok: false, message: 'IFSC must be 11 characters in the format ABCD0123456.' };
    }
    if (v.openingBalancePaise !== 0n) {
      if (!v.openingBalanceDate) {
        return { ok: false, message: 'Pick the date the opening balance is as of.' };
      }
      // The opening balance posts to the ledger, which needs `post_transaction`.
      // Check up front: the create dialog is one-shot (the opening balance can't
      // be set later), so failing after the row is created would strand the
      // account with no opening and no way to add it. Fail fast with a clear
      // message instead of the generic "missing capability".
      requireCapability(
        ctx,
        'post_transaction',
        "Setting an opening balance needs the 'post transactions' permission, since it posts to the ledger. Add the account without an opening balance, or ask an admin to set it.",
      );
    }

    const [gl] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.code, BANK_GL_CODE))
      .limit(1);
    if (!gl) {
      return { ok: false, message: 'Ledger account 1120 (Bank Accounts) is missing — seed the chart of accounts first.' };
    }

    // Generate the id up front so the vault object can be keyed to it before
    // the row exists.
    const bankAccountId = crypto.randomUUID();
    const last4 = v.accountNumber.slice(-4);
    const { objectKey } = await storeBank(ctx, {
      accountNumber: v.accountNumber,
      entityType: 'office',
      entityId: bankAccountId,
    });

    try {
      await db.insert(bankAccounts).values({
        id: bankAccountId,
        accountId: gl.id,
        displayName: v.displayName,
        bankName: v.bankName,
        branch: norm(v.branch),
        accountLast4: last4,
        ifsc,
        accountType: v.accountType,
        vaultObjectKey: objectKey,
        openingBalancePaise: v.openingBalancePaise,
        openingBalanceDate: v.openingBalanceDate ?? null,
        currency: 'INR',
        isActive: true,
        notes: norm(v.notes),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      });
    } catch (e) {
      // Don't orphan the vault blob if the row insert fails.
      await removeVaultObject(objectKey);
      throw e;
    }

    await logAudit({
      actorId: ctx.userId,
      entityType: 'office',
      entityId: bankAccountId,
      action: 'insert',
      changes: {
        display_name: v.displayName,
        bank_name: v.bankName,
        opening_balance_paise: v.openingBalancePaise.toString(),
      },
    });

    // Opening-balance journal — posted so the trial balance stays balanced.
    // Done after the row is committed; a posting failure (e.g. the as-of date
    // sits in a closed period) leaves the account usable with a clear warning
    // rather than failing the whole create.
    let openingPosted = false;
    let openingWarning: string | undefined;
    if (v.openingBalancePaise !== 0n && v.openingBalanceDate) {
      try {
        const partnerUserId = await resolvePartnerUserId();
        const positive = v.openingBalancePaise > 0n;
        const amountPaise = positive ? v.openingBalancePaise : -v.openingBalancePaise;
        const externalRef = `opening_balance:${bankAccountId}`;
        const reason = `Opening balance for ${v.displayName}`;
        const draft = partnerUserId
          ? // Preferred: attribute the opening cash to partner capital (Cr 3100).
            await createDraftTransaction(ctx, {
              kind: positive ? 'partner_capital' : 'partner_drawing',
              // `kind` here is overridden by the router (partner_capital → 'capital',
              // partner_drawing → 'drawing'); we pass the matching value to satisfy
              // the template's input type.
              input: {
                kind: positive ? 'capital' : 'drawing',
                partnerUserId,
                bankAccountId,
                amountPaise,
                externalRef,
                txnDate: v.openingBalanceDate,
                notes: reason,
              },
            })
          : // No partner user on file → post against 3900 Opening Balance Equity
            // (non-control) via a journal so the opening still posts and tallies.
            // Dr 1120 / Cr 3900 for a positive balance; mirrored for an overdraft.
            await createDraftTransaction(ctx, {
              kind: 'journal',
              input: {
                externalRef,
                txnDate: v.openingBalanceDate,
                journalReason: reason,
                legs: [
                  {
                    accountCode: '1120',
                    side: positive ? ('debit' as const) : ('credit' as const),
                    amountPaise,
                    subledger: { entityType: 'office' as const, entityId: bankAccountId },
                  },
                  {
                    accountCode: '3900',
                    side: positive ? ('credit' as const) : ('debit' as const),
                    amountPaise,
                  },
                ],
                isOpeningBalance: true,
                notes: reason,
              },
            });
        await postTransaction(ctx, { transactionId: draft.transactionId });
        openingPosted = true;
      } catch (e) {
        openingWarning =
          e instanceof AppError
            ? e.message
            : 'The opening balance could not be posted to the ledger.';
        console.error('[banking.createAgencyBankAccount] opening balance posting failed', e);
      }
    }

    revalidatePath(BANKING_PATH);
    return { ok: true, id: bankAccountId, openingPosted, openingWarning };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * Edits the descriptive fields + active flag. The account number (vaulted) and
 * the opening balance (already posted to the ledger) are intentionally NOT
 * editable here — changing either is a ledger event, not a label tweak.
 */
export async function updateAgencyBankAccount(
  id: string,
  input: BankAccountPatchShape,
): Promise<ActionResult> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'manage_bank_accounts');
    const v = BankAccountPatch.parse(input);
    const ifsc = v.ifsc.toUpperCase();
    if (!IFSC_RE.test(ifsc)) {
      return { ok: false, message: 'IFSC must be 11 characters in the format ABCD0123456.' };
    }

    const [existing] = await db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, id))
      .limit(1);
    if (!existing) return { ok: false, message: 'Bank account not found.' };

    await db
      .update(bankAccounts)
      .set({
        displayName: v.displayName,
        bankName: v.bankName,
        branch: norm(v.branch),
        ifsc,
        accountType: v.accountType,
        isActive: v.isActive,
        notes: norm(v.notes),
        updatedBy: ctx.userId,
      })
      .where(eq(bankAccounts.id, id));

    await logAudit({
      actorId: ctx.userId,
      entityType: 'office',
      entityId: id,
      action: 'update',
      changes: { display_name: v.displayName, is_active: v.isActive },
    });

    revalidatePath(BANKING_PATH);
    return { ok: true };
  } catch (e) {
    return toErr(e);
  }
}
