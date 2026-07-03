import { mysqlTable, text, varchar } from 'drizzle-orm/mysql-core';

import { auditColumns, timestamps } from './_shared';

/**
 * Apar LLP itself (MariaDB port of ../schema/organizations.ts). Short captured
 * identifiers (GSTIN/PAN/TAN/Udyam) become bounded `varchar`; the free-text
 * addresses stay `text`.
 */
export const organizations = mysqlTable('organizations', {
  ...timestamps(),
  ...auditColumns(),
  legalName: varchar({ length: 512 }).notNull(),
  displayName: varchar({ length: 512 }).notNull(),
  gstin: varchar({ length: 32 }),
  pan: varchar({ length: 16 }),
  tan: varchar({ length: 16 }),
  udyam: varchar({ length: 32 }),
  registeredAddress: text(),
  secondaryAddress: text(),
});

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
