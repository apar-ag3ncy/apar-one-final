// Keep the ledger's agency bank accounts (`bank_accounts`, the sub-ledger for
// GL 1120) in sync with the invoice-block accounts managed in Settings →
// Billing (`company_bank_accounts`).
//
// WHY: the Bank Book reports (per-account + all-accounts) enumerate
// `bank_accounts` via listAgencyBankAccounts(). Accounts added in Settings →
// Billing only ever wrote `company_bank_accounts`, so they never appeared in
// the Bank Book. Per the product decision, adding/editing/removing a bank in
// Billing now mirrors a matching `bank_accounts` row so it shows up in the
// ledger reports and can carry cash movements.
//
// The two rows are linked WITHOUT a schema change: the mirror's
// `vault_object_key` — which for agency banks is only ever a synthetic marker
// (`manual:<uuid>` for hand-entered ones; there is no reveal-from-vault path on
// this table) — carries `company-bank:<companyBankAccountId>`. That doubles as
// a stable back-link to find/update/deactivate the mirror.
//
// The mirror opens with a ZERO opening balance, so NO opening-balance journal
// is posted — the sync needs only `manage_bank_accounts` (the capability the
// Billing CRUD already checks), never `post_transaction`.

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { accounts, bankAccounts } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';

/** A db handle or an open transaction — both expose select/insert/update. */
type DbClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

const LINK_PREFIX = 'company-bank:';
const linkKey = (companyBankAccountId: string): string => `${LINK_PREFIX}${companyBankAccountId}`;

/** The fields we copy from a company_bank_accounts row onto its ledger mirror. */
export type CompanyBankMirrorFields = {
  title: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  branchName: string | null;
  notes: string | null;
};

/** Ledger last-4 shown in the Bank Book — derived from the full number. */
function lastFour(accountNumber: string): string {
  const trimmed = accountNumber.trim();
  return trimmed.length > 4 ? trimmed.slice(-4) : trimmed;
}

/** The GL parent (1120 Bank Accounts) every agency bank row hangs off. */
async function bankGlAccountId(client: DbClient): Promise<string> {
  const [gl] = await client
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.code, '1120'))
    .limit(1);
  if (!gl) throw new AppError('internal', '1120 Bank Accounts GL account not found');
  return gl.id;
}

/** The live (not soft-deleted) ledger mirror for a company bank account, if any. */
async function findMirrorId(client: DbClient, companyBankAccountId: string): Promise<string | null> {
  const [row] = await client
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(
      and(
        eq(bankAccounts.vaultObjectKey, linkKey(companyBankAccountId)),
        isNull(bankAccounts.deletedAt),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/** Create the ledger mirror for a freshly created company bank account. */
export async function createBankLedgerMirror(
  client: DbClient,
  userId: string,
  companyBankAccountId: string,
  f: CompanyBankMirrorFields,
): Promise<void> {
  const glId = await bankGlAccountId(client);
  await client.insert(bankAccounts).values({
    accountId: glId,
    displayName: f.title,
    bankName: f.bankName,
    branch: f.branchName,
    accountLast4: lastFour(f.accountNumber),
    ifsc: f.ifsc,
    // company_bank_accounts has no account-type field; default to current.
    accountType: 'current',
    // Not a real vault object — doubles as the back-link to the owning
    // company_bank_accounts row (see module header).
    vaultObjectKey: linkKey(companyBankAccountId),
    openingBalancePaise: 0n,
    openingBalanceDate: null,
    isActive: true,
    notes: f.notes,
    createdBy: userId,
    updatedBy: userId,
  });
}

/**
 * Sync the ledger mirror after a company bank account is edited. Upserts: if no
 * mirror exists yet (e.g. an account created before this feature), one is
 * created so it starts showing in the Bank Book. Opening balance / movements
 * are never touched — only the descriptive fields.
 */
export async function updateBankLedgerMirror(
  client: DbClient,
  userId: string,
  companyBankAccountId: string,
  f: CompanyBankMirrorFields,
): Promise<void> {
  const mirrorId = await findMirrorId(client, companyBankAccountId);
  if (!mirrorId) {
    await createBankLedgerMirror(client, userId, companyBankAccountId, f);
    return;
  }
  await client
    .update(bankAccounts)
    .set({
      displayName: f.title,
      bankName: f.bankName,
      branch: f.branchName,
      accountLast4: lastFour(f.accountNumber),
      ifsc: f.ifsc,
      notes: f.notes,
      // Re-editing a previously removed-then-restored billing account should
      // bring its mirror back into the active list.
      isActive: true,
      updatedBy: userId,
    })
    .where(eq(bankAccounts.id, mirrorId));
}

/**
 * A company bank account was removed (soft delete). Deactivate its mirror
 * rather than delete it: the account may already carry posted cash movements,
 * which are immutable and must stay in the Bank Book. Inactive mirrors still
 * list (flagged "inactive") so history is preserved.
 */
export async function deactivateBankLedgerMirror(
  client: DbClient,
  userId: string,
  companyBankAccountId: string,
): Promise<void> {
  await client
    .update(bankAccounts)
    .set({ isActive: false, updatedBy: userId })
    .where(eq(bankAccounts.vaultObjectKey, linkKey(companyBankAccountId)));
}
