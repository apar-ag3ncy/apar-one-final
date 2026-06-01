import {
  boolean,
  char,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';

/**
 * Chart of accounts. LEDGER-SPEC §1.1.
 *
 * Five canonical types; v1 does not seed `contra_asset` rows
 * (depreciation deferred to product v2 per LEDGER-SPEC §9).
 */
export const accountTypeEnum = pgEnum('account_type', [
  'asset',
  'liability',
  'equity',
  'income',
  'expense',
  'contra_asset',
]);

/**
 * Sub-ledger entity kind. Determines what kind of polymorphic entity
 * a control-account posting must reference. v1 set:
 *   - bank_account → 1120 sub-ledger keyed to bank_accounts.id
 *   - client       → 1200 / 1240 / 4100 sub-ledger keyed to clients.id
 *   - vendor       → 1220 / 2110 / 5100 sub-ledger keyed to vendors.id
 *   - employee     → 1230 sub-ledger keyed to employees.id
 *   - partner_user_id → 3100 / 3200 sub-ledger keyed to users.id (role='partner')
 */
export const subledgerKindEnum = pgEnum('subledger_kind', [
  'bank_account',
  'client',
  'vendor',
  'employee',
  'partner_user_id',
]);

/**
 * Chart-of-accounts row. LEDGER-SPEC §2 (the 24-account starter chart)
 * + the prompt's `2180 Client Advances Received` addition = 25 accounts
 * seeded in `0007_ledger_schemas_and_seed.sql`.
 *
 * - `code` is the GL code ('1120', '4100', etc.) — immutable after
 *   a posting hits the account.
 * - `is_control` accounts receive only sub-ledger postings; their
 *   balance = sum of sub-ledger balances (invariant checked periodically,
 *   not realtime — LEDGER-SPEC §1.1).
 * - `parent_id` allows hierarchy ('1000 Assets' parent, '1110 Cash on
 *   Hand' child). Not required in v1 chart.
 * - `metadata.subledger_kind` is the polymorphic discriminator for
 *   control accounts. The validation engine reads this to dispatch
 *   to the right principal table.
 */
export const accounts = pgTable(
  'accounts',
  {
    ...timestamps(),
    ...auditColumns(),
    code: text().notNull(),
    name: text().notNull(),
    type: accountTypeEnum().notNull(),
    parentId: uuid(),
    isControl: boolean().notNull().default(false),
    subledgerKind: subledgerKindEnum(), // required iff isControl=true
    isActive: boolean().notNull().default(true),
    currency: char({ length: 3 }).notNull().default('INR'),
    metadata: jsonb().notNull().default({}),
    closedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('accounts_code_unique').on(t.code),
    index().on(t.type),
    index().on(t.parentId),
    index().on(t.isControl),
  ],
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
