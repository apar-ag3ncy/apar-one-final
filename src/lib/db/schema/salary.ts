import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { auditColumns, timestamps as sharedTimestamps } from './_shared';
import { documents } from './documents';
import { employees } from './employees';
import { periods } from './periods';
import { projects } from './projects';
import { users } from './users';

/**
 * Salary structures (SPEC-AMENDMENT-001 §9.1). Versioned per employee
 * via `effective_from` / `effective_to`. CAPTURED, not computed:
 * basic, hra, allowances, employer EPF/ESI etc. all entered by HR
 * from the offer letter / revision letter.
 */
export const salaryStructures = pgTable(
  'salary_structures',
  {
    ...sharedTimestamps(),
    ...auditColumns(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    effectiveFrom: date().notNull(),
    effectiveTo: date(),
    basicPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    hraPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    specialAllowancePaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    otherAllowances: jsonb().notNull().default([]),
    employerEpfPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    employerEsiPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    ctcMonthlyPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    sourceDocumentId: uuid().references(() => documents.id, {
      onDelete: 'restrict',
    }),
    notes: text(),
  },
  (t) => [
    index().on(t.employeeId, t.effectiveFrom.desc()),
    index().on(t.employeeId, t.effectiveTo),
    // A version's end must not precede its start. Guards against the inverted
    // interval an auto-close of a back-dated structure could otherwise create
    // (mirrors the leaves table's date-range CHECK). Added in migration 0050.
    check(
      'salary_structures_date_range_ordered',
      sql`effective_to IS NULL OR effective_to >= effective_from`,
    ),
  ],
);

export type SalaryStructure = typeof salaryStructures.$inferSelect;
export type NewSalaryStructure = typeof salaryStructures.$inferInsert;

export const salaryRunStatusEnum = pgEnum('salary_run_status', ['draft', 'posted', 'reversed']);

export const salaryRuns = pgTable(
  'salary_runs',
  {
    ...sharedTimestamps(),
    ...auditColumns(),
    periodId: uuid()
      .notNull()
      .references(() => periods.id, { onDelete: 'restrict' }),
    status: salaryRunStatusEnum().notNull().default('draft'),
    postedAt: timestamp({ withTimezone: true }),
    postedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    reversedAt: timestamp({ withTimezone: true }),
    reversedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    sourceDocumentId: uuid().references(() => documents.id, {
      onDelete: 'restrict',
    }),
    /** When true, post one transaction per line; else one txn per run. */
    perEmployeeTransactions: text().notNull().default('true'),
    notes: text(),
  },
  (t) => [index().on(t.periodId), index().on(t.status)],
);

export type SalaryRun = typeof salaryRuns.$inferSelect;

export const salaryLines = pgTable(
  'salary_lines',
  {
    ...sharedTimestamps(),
    salaryRunId: uuid()
      .notNull()
      .references(() => salaryRuns.id, { onDelete: 'restrict' }),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    grossPaise: bigint({ mode: 'bigint' }).notNull(),
    employeeEpfPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    employeeEsiPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    ptPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    tdsPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    otherDeductions: jsonb().notNull().default([]),
    netPaise: bigint({ mode: 'bigint' }).notNull(),
    payslipDocumentId: uuid().references(() => documents.id, {
      onDelete: 'set null',
    }),
    transactionId: uuid(), // ledger txn id once posted
    notes: text(),
  },
  (t) => [index().on(t.salaryRunId), index().on(t.employeeId, t.salaryRunId)],
);

export type SalaryLine = typeof salaryLines.$inferSelect;

/**
 * Salary payments — individual disbursements actually paid out to an employee
 * (amount + date). Captured, not computed. Surfaced in the employee
 * Compensation tab and a per-employee Salary Book. Each payment posts a real
 * double-entry transaction (Dr 6100 Salaries & Wages / Cr 1110 Cash on Hand),
 * attributed to the employee on the transaction header; `transactionId` links
 * the capture row to that posting (mirroring `salary_lines.transaction_id`).
 */
export const salaryPayments = pgTable(
  'salary_payments',
  {
    ...sharedTimestamps(),
    ...auditColumns(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    paidOn: date().notNull(),
    amountPaise: bigint({ mode: 'bigint' }).notNull(),
    // What the employee was DUE for the period (attendance-prorated gross at
    // record time) — stored beside the amount actually paid so under/over
    // payment is visible later. Null on legacy rows recorded before capture.
    expectedAmountPaise: bigint({ mode: 'bigint' }),
    // How the salary left the company: 'cash' → Cr 1110, 'bank' → Cr 1120
    // sub-ledgered to bank_account_id. Legacy rows all posted cash.
    paymentMethod: text().notNull().default('cash'),
    // Agency bank the payment went out from (bank_accounts.id) when
    // payment_method = 'bank'. FK added in the SQL migration; kept a plain
    // uuid here like transaction_id.
    bankAccountId: uuid(),
    notes: text(),
    // Ledger transaction this payment posted. FK added in the SQL migration;
    // kept a plain uuid here like salary_lines.transaction_id.
    transactionId: uuid(),
  },
  (t) => [index().on(t.employeeId, t.paidOn.desc()), index().on(t.paidOn)],
);

export type SalaryPayment = typeof salaryPayments.$inferSelect;
export type NewSalaryPayment = typeof salaryPayments.$inferInsert;

export const bonusKindEnum = pgEnum('bonus_kind', [
  'bonus',
  'perk_cash',
  'perk_inkind',
  'gift',
  'award',
]);

export const bonusesAndPerks = pgTable(
  'bonuses_and_perks',
  {
    ...sharedTimestamps(),
    ...auditColumns(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    kind: bonusKindEnum().notNull(),
    bonusDate: date().notNull(),
    amountPaise: bigint({ mode: 'bigint' }),
    description: text().notNull(),
    sourceDocumentId: uuid().references(() => documents.id, {
      onDelete: 'restrict',
    }),
    transactionId: uuid(),
    taxable: text().notNull().default('captured'), // 'taxable'|'not_taxable'|'captured'
  },
  (t) => [index().on(t.employeeId, t.bonusDate.desc())],
);

export const reimbursementStatusEnum = pgEnum('reimbursement_status', [
  'submitted',
  'approved',
  'rejected',
  'paid',
]);

export const reimbursementAttributionEnum = pgEnum('reimbursement_attribution', ['client', 'opex']);

export const reimbursements = pgTable(
  'reimbursements',
  {
    ...sharedTimestamps(),
    ...auditColumns(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    claimDate: date().notNull(),
    amountPaise: bigint({ mode: 'bigint' }).notNull(),
    attribution: reimbursementAttributionEnum().notNull(),
    onBehalfOfClientId: uuid(),
    projectId: uuid().references(() => projects.id, { onDelete: 'restrict' }),
    description: text().notNull(),
    receiptDocumentId: uuid()
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    status: reimbursementStatusEnum().notNull().default('submitted'),
    approvedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp({ withTimezone: true }),
    paidViaTransactionId: uuid(),
    notes: text(),
  },
  (t) => [index().on(t.employeeId, t.claimDate.desc()), index().on(t.status)],
);

export type Reimbursement = typeof reimbursements.$inferSelect;

export const leaveKindEnum = pgEnum('leave_kind', [
  'earned',
  'casual',
  'sick',
  'unpaid',
  'comp_off',
  'maternity',
  'paternity',
]);

export const leaveStatusEnum = pgEnum('leave_status', [
  'applied',
  'approved',
  'rejected',
  'cancelled',
]);

export const leaves = pgTable(
  'leaves',
  {
    ...sharedTimestamps(),
    ...auditColumns(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    kind: leaveKindEnum().notNull(),
    fromDate: date().notNull(),
    toDate: date().notNull(),
    days: text().notNull(), // 'numeric(4,1)' stored as text to avoid Drizzle Decimal mapping
    status: leaveStatusEnum().notNull().default('applied'),
    appliedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    approvedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp({ withTimezone: true }),
    notes: text(),
  },
  (t) => [index().on(t.employeeId, t.fromDate.desc()), index().on(t.status)],
);

export type Leave = typeof leaves.$inferSelect;
