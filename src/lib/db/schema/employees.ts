import { boolean, date, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { contractStatusEnum } from './_polymorphic';
import { users } from './users';

export const employeeStatusEnum = pgEnum('employee_status', [
  'prospective',
  'active',
  'on_leave',
  'notice',
  'separated',
]);

export const employmentTypeEnum = pgEnum('employment_type', [
  'full_time',
  'part_time',
  'contract',
  'intern',
  'consultant',
]);

/**
 * Employees — third principal entity. HRMS surface (leaves, attendance,
 * reimbursements, payslips, KPIs, etc.) is layered on top in Phases 4.5
 * and 4.6.
 *
 * - `userId` — nullable FK to `auth.users.id` per SPEC-AMENDMENT-001 §8.1.
 *   HR creates the employee record, then optionally invites them via
 *   Supabase Auth; on first login the invite trigger populates `userId`.
 *   Legacy employees without portal access stay `NULL`.
 * - `masked*` fields: full PAN/Aadhaar live in the vault via
 *   `entity_tax_identifiers.vault_object_key`. The row never holds
 *   plaintext KYC.
 * - Contract gating: every new employee needs a signed offer letter +
 *   contract document (AUDIT-GAPS §1.3 + brief).
 * - Archive on separation: `isArchived` flips on the day of separation;
 *   `separatedOn` records the date. The 7-year-anonymization job (CLAUDE
 *   rule #29) scans for separated_on + 7y.
 */
export const employees = pgTable(
  'employees',
  {
    ...timestamps(),
    ...auditColumns(),
    // Auth linkage — see SPEC-AMENDMENT-001 §8.1. Cross-schema FK to
    // auth.users is not Drizzle-enforceable; the invite trigger in
    // Phase 3 keeps this in sync.
    userId: uuid(),

    // Identity (free of KYC)
    employeeCode: text().notNull().unique(), // 'APAR-001'; immutable once issued
    fullName: text().notNull(),
    displayName: text(),
    workEmail: text().unique(),
    personalEmail: text(),
    phone: text(),

    // Employment
    employmentType: employmentTypeEnum().notNull(),
    status: employeeStatusEnum().notNull().default('active'),
    designation: text(),
    department: text(),
    // Salary grade level (0071). One text column — the employee *type* is
    // derivable from the first letter: Intern → I; Probation → PA/PB/PC/PA+;
    // Employee → EA/EB/EC/EA+. Nullable for legacy / ungraded teammates.
    // Values are validated by the zod enum in create/updateEmployee.
    payrollGrade: text(),
    reportsToEmployeeId: uuid(), // self-FK, added in migration
    /**
     * Employee-portal role (0082): 'member' | 'manager'. DB CHECK-constrained.
     * Managers get the pending-leave queue over their reporting SUBTREE
     * (transitive `reportsToEmployeeId`); members only ever see themselves.
     * Defaults to 'member' so everyone is least-privileged until promoted.
     * Not derived from `designation` — a job-title rename must never silently
     * grant approval rights.
     */
    portalRole: text().notNull().default('member'),
    joinedOn: date().notNull(),
    // Optional date of birth (no time component). Nullable for legacy rows
    // and employees who haven't supplied it.
    dateOfBirth: date(),
    confirmedOn: date(),
    // Custom probation end date (0081). When set, the "Probation" badge + days-left
    // derive from this instead of the default 6-months-from-joining window; cleared
    // to NULL when the employee is confirmed / marked fixed. NULL → legacy derived
    // behaviour for eligible employment types (see lib/employee-badges.ts).
    probationEndsOn: date(),
    separatedOn: date(),
    noticePeriodDays: text(), // captured as text — "30 days" or "2 months"

    // Masked KYC; full goes to `entity_tax_identifiers` vault
    maskedPan: text(),
    maskedAadhaar: text(),

    // Contract gating
    contractStatus: contractStatusEnum().notNull().default('pending'),
    contractPendingReason: text(),
    contractPendingUntil: date(),

    // Archive
    isArchived: boolean().notNull().default(false),
    archivedAt: timestamp({ withTimezone: true }),
    archivedBy: uuid().references(() => users.id, { onDelete: 'set null' }),

    notes: text(),
  },
  (t) => [
    index().on(t.status),
    index().on(t.userId),
    index().on(t.workEmail),
    index().on(t.fullName),
    index().on(t.reportsToEmployeeId),
    index().on(t.isArchived),
  ],
);

export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
