import { boolean, index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { entityTypeEnum } from './_polymorphic';

export const bankAccountTypeEnum = pgEnum('bank_account_type', [
  'current',
  'savings',
  'od',
  'escrow',
]);

/**
 * Polymorphic bank accounts. Vault discipline per AUDIT-GAPS §1.2 +
 * brief Rule 46:
 *
 *   row    → holder_name, account_last4, ifsc, bank_name, branch,
 *            account_type, is_primary, vault_object_key
 *   vault  → full account number (encrypted blob in Supabase Storage)
 *
 * `vaultObjectKey` is a storage path inside the `restricted-kyc`
 * bucket; reveal goes through `lib/storage.ts:revealBank` which
 * (a) checks `reveal_bank` capability, (b) returns a 60s signed URL,
 * (c) writes an audit_log + entity_activity_log row.
 *
 * NEVER add an `account_number` column. The check-no-plaintext-pii
 * script (Phase 3+) will fail CI if anyone tries.
 */
export const entityBankAccounts = pgTable(
  'entity_bank_accounts',
  {
    ...timestamps(),
    ...auditColumns(),
    entityType: entityTypeEnum().notNull(),
    entityId: uuid().notNull(),

    holderName: text().notNull(),
    accountLast4: text().notNull(), // '1234' — exactly 4 chars; validated in form layer
    ifsc: text().notNull(),
    bankName: text().notNull(),
    branch: text(),
    accountType: bankAccountTypeEnum().notNull(),
    isPrimary: boolean().notNull().default(false),

    // Vault pointer (no plaintext number)
    vaultObjectKey: text().notNull(),

    // Verification — set to true after cancelled-cheque/passbook upload
    isVerified: boolean().notNull().default(false),
    verifiedAt: text(), // timestamp; relaxed to text for now to allow null + free-form notes alongside
    verificationNotes: text(),

    notes: text(),
  },
  (t) => [index().on(t.entityType, t.entityId), index().on(t.ifsc)],
);

export type EntityBankAccount = typeof entityBankAccounts.$inferSelect;
export type NewEntityBankAccount = typeof entityBankAccounts.$inferInsert;
