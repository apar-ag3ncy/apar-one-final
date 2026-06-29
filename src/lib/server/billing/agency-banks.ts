'use server';

import { asc, desc } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { bankAccounts } from '@/lib/db/schema';
import { getActorContext } from '@/lib/server/actor';

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

export async function listAgencyBankAccounts(): Promise<readonly AgencyBankAccountRow[]> {
  await getActorContext();
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
