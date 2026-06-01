import {
  bigint,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { auditColumns } from './_shared';
import { timestamps } from './_ledger';
import { clients } from './clients';
import { employees } from './employees';
import { entityTypeEnum } from './_polymorphic';
import { documents } from './documents';
import { periods } from './periods';
import { projects } from './projects';
import { users } from './users';
import { vendors } from './vendors';

/**
 * v2 transaction kinds. LEDGER-SPEC §3 has 11 kinds + the
 * SPEC-AMENDMENT-001 §9.2 payroll additions:
 *
 *   - salary_disbursement (batch-aware)
 *   - bonus_payment
 *
 * Total 13 kinds.
 */
export const transactionKindEnum = pgEnum('transaction_kind', [
  'client_invoice',
  'client_payment_received',
  'client_advance_received',
  'vendor_bill',
  'vendor_payment_made',
  'expense_on_behalf',
  'employee_reimbursement',
  'office_expense',
  'inter_bank_transfer',
  'partner_capital',
  'partner_drawing',
  'journal',
  'salary_disbursement', // SPEC-AMENDMENT-001 §9.2
  'bonus_payment', // SPEC-AMENDMENT-001 §9.2
]);

export const transactionStatusEnum = pgEnum('transaction_status', ['draft', 'posted', 'reversed']);

export const transactionSourceKindEnum = pgEnum('transaction_source_kind', [
  'invoice',
  'bill',
  'receipt',
  'payment',
  'payslip',
  'journal',
  'bank_import',
  'extraction',
  'opening_balance',
]);

/**
 * Transactions header. LEDGER-SPEC §1.2.
 *
 * Invariants enforced in `0007_ledger_schemas_and_seed.sql`:
 *   - external_ref UNIQUE
 *   - source_document_id NOT NULL except for kinds in
 *     ('journal','inter_bank_transfer','opening_balance')
 *   - Balanced postings: deferred constraint trigger at COMMIT
 *   - No edits to status IN ('posted','reversed') except whitelisted columns
 *     (validation_flags, validation_acknowledged_*, notes, reconciliation_status
 *     on the postings child)
 *   - No deletes ever (RLS blocks DELETE for everyone including service_role)
 *   - Control discipline (postings to is_control accounts require sub-ledger
 *     fields) — enforced on the `postings` child via CHECK + trigger
 *
 * Uses `_ledger.timestamps()` (no `deleted_at`).
 */
export const transactions = pgTable(
  'transactions',
  {
    ...timestamps(),
    ...auditColumns(),
    kind: transactionKindEnum().notNull(),
    externalRef: text().notNull(),
    description: text(),
    txnDate: date().notNull(),
    status: transactionStatusEnum().notNull().default('draft'),
    postedAt: timestamp({ withTimezone: true }),
    postedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    reversedAt: timestamp({ withTimezone: true }),
    reversedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    reversesId: uuid(),
    correctionForId: uuid(), // partner-only post-close correction link

    sourceKind: transactionSourceKindEnum().notNull(),
    sourceDocumentId: uuid().references(() => documents.id, {
      onDelete: 'restrict',
    }),

    // Optional principal-entity refs — the "headline" parties for the txn
    relatedEntityKind: entityTypeEnum(),
    relatedEntityId: uuid(),

    // Per-client P&L tag — the §0.6 "sacred" attribution field
    onBehalfOfClientId: uuid().references(() => clients.id, {
      onDelete: 'restrict',
    }),
    paidToVendorId: uuid().references(() => vendors.id, { onDelete: 'restrict' }),
    incurredByEmployeeId: uuid().references(() => employees.id, {
      onDelete: 'restrict',
    }),
    projectId: uuid().references(() => projects.id, { onDelete: 'restrict' }),

    periodId: uuid().references(() => periods.id, { onDelete: 'restrict' }),
    extractionJobId: uuid(), // FK lands in Phase 3 extraction module

    validationFlags: jsonb().notNull().default([]),
    validationAcknowledgedBy: uuid().references(() => users.id, {
      onDelete: 'set null',
    }),
    validationAcknowledgedAt: timestamp({ withTimezone: true }),

    notes: text(),
  },
  (t) => [
    uniqueIndex('transactions_external_ref_unique').on(t.externalRef),
    index().on(t.kind),
    index().on(t.status),
    index().on(t.txnDate),
    index().on(t.periodId),
    index().on(t.onBehalfOfClientId, t.txnDate.desc()),
    index().on(t.paidToVendorId, t.txnDate.desc()),
    index().on(t.incurredByEmployeeId, t.txnDate.desc()),
    index().on(t.projectId, t.txnDate.desc()),
    index().on(t.reversesId),
    index().on(t.sourceDocumentId),
  ],
);

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

export const postingSideEnum = pgEnum('posting_side', ['debit', 'credit']);

export const reconciliationStatusEnum = pgEnum('reconciliation_status', [
  'unreconciled',
  'matched',
  'manual',
  'na',
]);

/**
 * Posting (one leg of a balanced journal entry). LEDGER-SPEC §1.2.
 *
 * `amount_paise` is always POSITIVE; `side` distinguishes debit/credit.
 * Balanced check (deferred): SUM(debit) = SUM(credit) per posted txn.
 *
 * Control-account discipline: if `account.is_control=true`, the posting
 * row MUST carry `subledger_entity_type` + `subledger_entity_id`. The
 * trigger validates the (entity_type, entity_id) pair resolves in the
 * matching principal table.
 *
 * `reconciliation_status` is editable AFTER post (whitelisted field).
 */
export const postings = pgTable(
  'postings',
  {
    ...timestamps(),
    transactionId: uuid().notNull(),
    accountId: uuid().notNull(),
    subledgerEntityType: entityTypeEnum(),
    subledgerEntityId: uuid(),
    side: postingSideEnum().notNull(),
    // CLAUDE rule #1: bigint paise everywhere. The bigint import above is
    // used here. mode:'bigint' returns native JS bigint in TS.
    amountPaise: bigint({ mode: 'bigint' }).notNull(),
    currency: text().notNull().default('INR'),
    fxRate: bigint({ mode: 'bigint' }), // unused in v1; reserved for multi-currency
    reconciliationStatus: reconciliationStatusEnum().notNull().default('unreconciled'),
    bankStatementLineId: uuid(),
    metadata: jsonb().notNull().default({}),
  },
  (t) => [
    index().on(t.transactionId),
    index().on(t.accountId, t.createdAt.desc()),
    index().on(t.accountId, t.subledgerEntityType, t.subledgerEntityId),
    index().on(t.subledgerEntityType, t.subledgerEntityId),
    index().on(t.bankStatementLineId),
  ],
);

export type Posting = typeof postings.$inferSelect;
export type NewPosting = typeof postings.$inferInsert;
