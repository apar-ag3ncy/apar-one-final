import { pgTable, text } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';

/**
 * Apār LLP itself. Seeded with one row by `npm run db:seed` (Phase 1 task).
 * Captured (not computed): GSTIN / PAN are stored as entered, never derived.
 */
export const organizations = pgTable('organizations', {
  ...timestamps(),
  ...auditColumns(),
  legalName: text().notNull(),
  displayName: text().notNull(),
  gstin: text(),
  pan: text(),
  registeredAddress: text(),
});
