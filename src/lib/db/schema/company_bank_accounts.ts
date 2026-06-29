import { boolean, integer, pgTable, text } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';

/**
 * Apar's own bank accounts — the accounts the agency invoices payments into
 * and pays vendors/salary from. Managed from Settings → Billing.
 *
 * Deliberately NOT the `entity_bank_accounts` vault table: those mask the
 * number + stash the full value behind a 60s signed URL (third-party KYC
 * discipline). The agency's OWN accounts are the opposite — they go on every
 * invoice's payment-instructions block and staff copy them constantly, so the
 * full account number lives on the row and is freely copyable. Singleton-org
 * scope, so no `company_id` FK is needed.
 *
 * Exactly one row should carry `isPrimary=true`; the server action flips the
 * others off when a new primary is chosen.
 */
export const companyBankAccounts = pgTable('company_bank_accounts', {
  ...timestamps(),
  ...auditColumns(),
  /** Display label, e.g. "Operating — HDFC" or "Payroll". */
  title: text().notNull(),
  /** Full account number (agency-owned; copyable, not vaulted). */
  accountNumber: text().notNull(),
  ifsc: text().notNull(),
  bankName: text().notNull(),
  branchName: text(),
  isPrimary: boolean().notNull().default(false),
  /** Manual ordering for the list; primary floats to the top regardless. */
  sortOrder: integer().notNull().default(0),
  notes: text(),
});

export type CompanyBankAccount = typeof companyBankAccounts.$inferSelect;
export type NewCompanyBankAccount = typeof companyBankAccounts.$inferInsert;
