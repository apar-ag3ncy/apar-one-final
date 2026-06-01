import { bigint, boolean, char, date, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { accounts, subledgerKindEnum } from './accounts';
import { bankAccountTypeEnum } from './entity_bank_accounts';

/**
 * Agency bank accounts (Apār LLP's own). LEDGER-SPEC §1.4.
 *
 * **Distinct from `entity_bank_accounts`**, which holds clients' / vendors' /
 * employees' bank accounts. This table holds the bank accounts the
 * agency itself owns and posts cash flow through. Same vault discipline:
 * full number is encrypted in `restricted-kyc` bucket, only
 * `account_last4` + `vault_object_key` on the row.
 *
 * Each row pairs with a sub-ledger entry on `1120 Bank Accounts`
 * (`is_control=true`, `subledger_kind='bank_account'`). The `account_id`
 * FK is the GL account; `display_name` is the human label.
 *
 * Opening balance: captured as `opening_balance_paise` at
 * `opening_balance_date`. The opening JV (a `journal` kind transaction
 * dated 1-Apr-2026 per the prompt's fresh-start decision) posts
 * `Dr 1120(sub) / Cr 3100 Partner Capital` for each bank's opening.
 */
export const bankAccounts = pgTable(
  'bank_accounts',
  {
    ...timestamps(),
    ...auditColumns(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    displayName: text().notNull(),
    bankName: text().notNull(),
    branch: text(),
    accountLast4: text().notNull(),
    ifsc: text().notNull(),
    accountType: bankAccountTypeEnum().notNull(),
    vaultObjectKey: text().notNull(),
    openingBalancePaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    openingBalanceDate: date(),
    currency: char({ length: 3 }).notNull().default('INR'),
    isActive: boolean().notNull().default(true),
    notes: text(),
  },
  (t) => [index().on(t.accountId), index().on(t.displayName)],
);

export type BankAccount = typeof bankAccounts.$inferSelect;
export type NewBankAccount = typeof bankAccounts.$inferInsert;
