'use server';

import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, isNull, like } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { accounts, bankAccounts, companyBankAccounts, transactions } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { type CurrentUserContext, requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { createDraftTransaction, postTransaction, reverseTransaction } from '@/lib/server/ledger';
import { type BankBook, getBankBook } from '@/lib/server/ledger/statements';

type DbClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Lists the agency's OWN bank accounts (the `bank_accounts` table — the
 * sub-ledger for GL account `1120 Bank Accounts`). These are the accounts a
 * client receipt lands INTO and a vendor payment leaves FROM; the row `id` is
 * what `recordManualReceipt` / `recordVendorPayment` pass as `bankAccountId`
 * and what the 1120 control-account posting carries as its sub-ledger entity.
 *
 * Distinct from:
 *   - `entity_bank_accounts` — clients'/vendors' banks (listBankAccounts), and
 *   - `company_bank_accounts` — the bank block printed on invoice PDFs.
 *
 * Inactive accounts are intentionally NOT filtered out: the seed ships a single
 * default account flagged inactive, and excluding it would leave the picker
 * empty. Active accounts float to the top.
 */

export type AgencyBankAccountRow = {
  id: string;
  label: string;
  bankName: string;
  accountLast4: string;
  isActive: boolean;
};

/**
 * Keep the ledger's bank list in sync with Settings: any bank the operator
 * added under Settings ▸ Billing (`company_bank_accounts`) is mirrored into
 * `bank_accounts` on first read, so every payment picker — receipts, vendor
 * payments, salaries — sees it without a second data-entry step. Idempotent:
 * each mirror is tagged `company:<id>` in `vault_object_key`. Opening balance
 * starts at 0 (editable later from Settings ▸ Banking).
 */
async function mirrorCompanyBanksIntoLedger(actorId: string): Promise<void> {
  const companyRows = await db.select().from(companyBankAccounts);
  if (companyRows.length === 0) return;
  const existing = await db
    .select({ marker: bankAccounts.vaultObjectKey, last4: bankAccounts.accountLast4 })
    .from(bankAccounts);
  const markers = new Set(existing.map((e) => e.marker));
  const last4s = new Set(existing.map((e) => e.last4));
  let glId: string | null = null;
  for (const c of companyRows) {
    const marker = `company:${c.id}`;
    if (markers.has(marker)) continue;
    const digits = c.accountNumber.replace(/\D/g, '');
    const last4 = digits.slice(-4) || '0000';
    // A manually-created ledger bank with the same last-4 already covers it.
    if (last4s.has(last4)) continue;
    glId = glId ?? (await bankGlAccountId());
    await db.insert(bankAccounts).values({
      accountId: glId,
      displayName: c.title,
      bankName: c.bankName,
      branch: c.branchName ?? null,
      accountLast4: last4,
      ifsc: c.ifsc,
      accountType: 'current',
      vaultObjectKey: marker,
      openingBalancePaise: 0n,
      openingBalanceDate: null,
      isActive: true,
      notes: 'Mirrored from Settings ▸ Billing bank accounts',
      createdBy: actorId,
      updatedBy: actorId,
    });
  }
}

export async function listAgencyBankAccounts(): Promise<readonly AgencyBankAccountRow[]> {
  const ctx = await getActorContext();
  try {
    await mirrorCompanyBanksIntoLedger(ctx.userId);
  } catch {
    // The mirror is a convenience — a failure must never break the pickers.
  }
  const rows = await db
    .select({
      id: bankAccounts.id,
      displayName: bankAccounts.displayName,
      bankName: bankAccounts.bankName,
      accountLast4: bankAccounts.accountLast4,
      isActive: bankAccounts.isActive,
    })
    .from(bankAccounts)
    .orderBy(desc(bankAccounts.isActive), asc(bankAccounts.displayName));

  return rows.map((r) => ({
    id: r.id,
    label: r.displayName,
    bankName: r.bankName,
    accountLast4: r.accountLast4,
    isActive: r.isActive,
  }));
}

// ───────────────────────────────────────────────────────────────────────────
// Agency bank-account management (create / edit + opening balance) and the
// per-bank book. The opening balance is captured on the row AND posted as an
// opening-balance journal voucher (Dr 1120 sub:bank / Cr 3900 Opening Balance
// Equity) dated `openingBalanceDate`, so the global trial balance stays
// balanced and the bank book shows it as the first line. Editing the opening
// balance reverses the prior JV and posts a fresh one.
// ───────────────────────────────────────────────────────────────────────────

const BANK_TYPES = ['current', 'savings', 'od', 'escrow'] as const;

const AgencyBankInputSchema = z.object({
  displayName: z.string().trim().min(1, 'Name is required'),
  bankName: z.string().trim().min(1, 'Bank name is required'),
  branch: z.string().trim().nullish(),
  accountLast4: z
    .string()
    .trim()
    .regex(/^\d{2,8}$/, 'Last digits should be 2–8 numbers'),
  ifsc: z.string().trim().min(4, 'IFSC is required'),
  accountType: z.enum(BANK_TYPES),
  openingBalancePaise: z.bigint().default(0n),
  openingBalanceDate: z.string().nullish(),
  isActive: z.boolean().default(true),
  notes: z.string().trim().nullish(),
});

export type AgencyBankInput = z.input<typeof AgencyBankInputSchema>;

export type AgencyBankDetail = {
  id: string;
  displayName: string;
  bankName: string;
  branch: string | null;
  accountLast4: string;
  ifsc: string;
  accountType: (typeof BANK_TYPES)[number];
  openingBalancePaise: bigint;
  openingBalanceDate: string | null;
  isActive: boolean;
  notes: string | null;
  /** Current book balance = opening ± all posted movements. */
  currentBalancePaise: bigint;
};

/** The 1120 control account is the GL parent for every agency bank row. */
async function bankGlAccountId(client: DbClient | typeof db = db): Promise<string> {
  const [gl] = await client
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.code, '1120'))
    .limit(1);
  if (!gl) throw new AppError('internal', '1120 Bank Accounts GL account not found');
  return gl.id;
}

/**
 * Posts the opening-balance JV for a bank. Positive opening = money already in
 * the bank → Dr 1120(sub) / Cr 3900. Negative (overdraft) flips the sides.
 * Runs inside the caller's transaction so the freshly-inserted bank row is
 * visible to the 1120 control trigger.
 */
async function postOpeningJv(
  ctx: CurrentUserContext,
  args: {
    bankAccountId: string;
    displayName: string;
    openingBalancePaise: bigint;
    openingBalanceDate: string;
  },
  client: DbClient,
): Promise<void> {
  const abs =
    args.openingBalancePaise < 0n ? -args.openingBalancePaise : args.openingBalancePaise;
  if (abs === 0n) return;
  const bankDebit = args.openingBalancePaise > 0n;
  const draft = await createDraftTransaction(
    ctx,
    {
      kind: 'journal',
      input: {
        externalRef: `obe:${args.bankAccountId}:${Date.now()}`,
        txnDate: args.openingBalanceDate,
        journalReason: `Opening balance for bank ${args.displayName} as of ${args.openingBalanceDate}`,
        legs: [
          {
            accountCode: '1120',
            side: bankDebit ? 'debit' : 'credit',
            amountPaise: abs,
            subledger: { entityType: 'office', entityId: args.bankAccountId },
          },
          { accountCode: '3900', side: bankDebit ? 'credit' : 'debit', amountPaise: abs },
        ],
        isOpeningBalance: true,
        notes: null,
      },
    },
    client as unknown as typeof db,
  );
  await postTransaction(
    ctx,
    { transactionId: draft.transactionId, acknowledgedFlags: [] },
    client as unknown as typeof db,
  );
}

/** Finds the active (posted, not-yet-reversed) opening JV for a bank, if any. */
async function findActiveOpeningJv(bankAccountId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        like(transactions.externalRef, `obe:${bankAccountId}:%`),
        eq(transactions.status, 'posted'),
        // Exclude reversal contra-entries: their externalRef is
        // `obe:<id>:<ts>:REV:<ts>` (matches the LIKE) and they stay
        // status='posted', so without this we could reverse a reversal.
        isNull(transactions.reversesId),
      ),
    )
    .orderBy(desc(transactions.createdAt))
    .limit(1);
  return row?.id ?? null;
}

export async function createAgencyBankAccount(input: AgencyBankInput): Promise<{ id: string }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'post_transaction');
  const v = AgencyBankInputSchema.parse(input);

  const glId = await bankGlAccountId();
  const opening = v.openingBalancePaise ?? 0n;
  const openingDate = v.openingBalanceDate ?? null;
  const hasOpening = opening !== 0n && !!openingDate;

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(bankAccounts)
      .values({
        accountId: glId,
        displayName: v.displayName,
        bankName: v.bankName,
        branch: v.branch ?? null,
        accountLast4: v.accountLast4,
        ifsc: v.ifsc,
        accountType: v.accountType,
        // No vault upload flow for hand-entered banks; carry a stable marker.
        vaultObjectKey: `manual:${randomUUID()}`,
        openingBalancePaise: opening,
        openingBalanceDate: openingDate,
        isActive: v.isActive ?? true,
        notes: v.notes ?? null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: bankAccounts.id });
    if (!row) throw new AppError('internal', 'bank_accounts insert returned no row');

    if (hasOpening) {
      await postOpeningJv(
        ctx,
        {
          bankAccountId: row.id,
          displayName: v.displayName,
          openingBalancePaise: opening,
          openingBalanceDate: openingDate!,
        },
        tx,
      );
    }
    return row.id as string;
  });

  revalidatePath('/banking');
  return { id };
}

export async function updateAgencyBankAccount(
  input: AgencyBankInput & { id: string },
): Promise<{ id: string }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'post_transaction');
  const { id } = z.object({ id: z.string().uuid() }).parse({ id: input.id });
  const v = AgencyBankInputSchema.parse(input);

  const [existing] = await db
    .select({
      openingBalancePaise: bankAccounts.openingBalancePaise,
      openingBalanceDate: bankAccounts.openingBalanceDate,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.id, id))
    .limit(1);
  if (!existing) throw new AppError('not_found', 'Bank account not found');

  const opening = v.openingBalancePaise ?? 0n;
  const openingDate = v.openingBalanceDate ?? null;
  const openingChanged =
    existing.openingBalancePaise !== opening || existing.openingBalanceDate !== openingDate;

  // Reverse the prior opening JV OUTSIDE the row-update txn: reverseTransaction
  // opens its own transaction. Order: reverse old → update row → post new.
  if (openingChanged) {
    const activeJvId = await findActiveOpeningJv(id);
    if (activeJvId) {
      await reverseTransaction(ctx, {
        transactionId: activeJvId,
        reason: 'Opening balance edited — superseded by a corrected opening entry.',
      });
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(bankAccounts)
      .set({
        displayName: v.displayName,
        bankName: v.bankName,
        branch: v.branch ?? null,
        accountLast4: v.accountLast4,
        ifsc: v.ifsc,
        accountType: v.accountType,
        openingBalancePaise: opening,
        openingBalanceDate: openingDate,
        isActive: v.isActive ?? true,
        notes: v.notes ?? null,
        updatedBy: ctx.userId,
      })
      .where(eq(bankAccounts.id, id));

    if (openingChanged && opening !== 0n && openingDate) {
      await postOpeningJv(
        ctx,
        {
          bankAccountId: id,
          displayName: v.displayName,
          openingBalancePaise: opening,
          openingBalanceDate: openingDate,
        },
        tx,
      );
    }
  });

  revalidatePath('/banking');
  revalidatePath(`/banking/${id}`);
  return { id };
}

/** Full detail rows for the management list, each with its current book balance. */
export async function listAgencyBankAccountsDetailed(): Promise<readonly AgencyBankDetail[]> {
  await getActorContext();
  const rows = await db
    .select()
    .from(bankAccounts)
    .orderBy(desc(bankAccounts.isActive), asc(bankAccounts.displayName));

  const out: AgencyBankDetail[] = [];
  for (const r of rows) {
    const book = await getBankBook({ bankAccountId: r.id });
    out.push({
      id: r.id,
      displayName: r.displayName,
      bankName: r.bankName,
      branch: r.branch,
      accountLast4: r.accountLast4,
      ifsc: r.ifsc,
      accountType: r.accountType,
      openingBalancePaise: r.openingBalancePaise,
      openingBalanceDate: r.openingBalanceDate,
      isActive: r.isActive,
      notes: r.notes,
      currentBalancePaise: book.closingBalancePaise,
    });
  }
  return out;
}

export async function getAgencyBankAccount(id: string): Promise<AgencyBankDetail | null> {
  await getActorContext();
  const [r] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, id)).limit(1);
  if (!r) return null;
  const book = await getBankBook({ bankAccountId: r.id });
  return {
    id: r.id,
    displayName: r.displayName,
    bankName: r.bankName,
    branch: r.branch,
    accountLast4: r.accountLast4,
    ifsc: r.ifsc,
    accountType: r.accountType,
    openingBalancePaise: r.openingBalancePaise,
    openingBalanceDate: r.openingBalanceDate,
    isActive: r.isActive,
    notes: r.notes,
    currentBalancePaise: book.closingBalancePaise,
  };
}

/** The bank book (opening line + dated movements + running balance) for one bank. */
export async function getAgencyBankBook(args: {
  bankAccountId: string;
  from?: string;
  to?: string;
}): Promise<BankBook> {
  await getActorContext();
  return getBankBook(args);
}
