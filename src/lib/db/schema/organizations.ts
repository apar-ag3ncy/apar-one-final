import { pgTable, text } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';

/**
 * Apar LLP itself. Seeded with one row by `npm run db:seed` (Phase 1 task).
 * Captured (not computed): GSTIN / PAN / TAN / Udyam are stored as entered,
 * never derived. Editable from Settings → Company details.
 *
 * `registeredAddress` is the PRIMARY address (used by the invoice / credit-note
 * / receipt PDFs as the supplier address). `secondaryAddress` is an optional
 * second site / correspondence address surfaced in Company details.
 */
export const organizations = pgTable('organizations', {
  ...timestamps(),
  ...auditColumns(),
  legalName: text().notNull(),
  displayName: text().notNull(),
  gstin: text(),
  pan: text(),
  tan: text(),
  udyam: text(),
  registeredAddress: text(),
  secondaryAddress: text(),
});

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
