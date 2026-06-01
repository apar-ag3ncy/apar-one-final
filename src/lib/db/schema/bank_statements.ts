import {
  bigint,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { bankAccounts } from './bank_accounts';
import { documents } from './documents';
import { users } from './users';

export const bankStatementStatusEnum = pgEnum('bank_statement_status', ['in_progress', 'complete']);

export const bankLineMatchConfidenceEnum = pgEnum('bank_line_match_confidence', [
  'exact',
  'likely',
  'manual',
  'unmatched',
]);

/**
 * Bank statement header. LEDGER-SPEC §1.5.
 *
 * Upload a bank PDF / CSV → parse → store closing balance + per-line
 * rows in `bank_statement_lines` → auto-match to existing postings
 * by amount + date + narration → user reviews + manually matches or
 * creates new transactions for unmatched lines → statement is
 * `complete` when all lines are matched AND closing balance ties to
 * GL balance on `statement_to`.
 */
export const bankStatements = pgTable(
  'bank_statements',
  {
    ...timestamps(),
    ...auditColumns(),
    bankAccountId: uuid()
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'restrict' }),
    statementFrom: date().notNull(),
    statementTo: date().notNull(),
    uploadedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    uploadedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    sourceDocumentId: uuid().references(() => documents.id, {
      onDelete: 'restrict',
    }),
    closingBalancePaise: bigint({ mode: 'bigint' }).notNull(),
    importedLinesCount: integer().notNull().default(0),
    reconciliationStatus: bankStatementStatusEnum().notNull().default('in_progress'),
    notes: text(),
  },
  (t) => [index().on(t.bankAccountId, t.statementTo.desc()), index().on(t.reconciliationStatus)],
);

export type BankStatement = typeof bankStatements.$inferSelect;
export type NewBankStatement = typeof bankStatements.$inferInsert;

export const bankStatementLines = pgTable(
  'bank_statement_lines',
  {
    ...timestamps(),
    bankStatementId: uuid()
      .notNull()
      .references(() => bankStatements.id, { onDelete: 'cascade' }),
    lineDate: date().notNull(),
    description: text().notNull(),
    refNumber: text(),
    debitPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    creditPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    runningBalancePaise: bigint({ mode: 'bigint' }).notNull(),
    matchedPostingId: uuid(),
    matchedAt: timestamp({ withTimezone: true }),
    matchedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    matchConfidence: bankLineMatchConfidenceEnum().notNull().default('unmatched'),
  },
  (t) => [
    index().on(t.bankStatementId, t.lineDate),
    index().on(t.matchConfidence),
    index().on(t.matchedPostingId),
  ],
);

export type BankStatementLine = typeof bankStatementLines.$inferSelect;
export type NewBankStatementLine = typeof bankStatementLines.$inferInsert;
