import { boolean, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { userRoleEnum } from './users';

/**
 * Role × Capability matrix. AUDIT-GAPS §3:
 *
 *   - Capabilities are a CLOSED ENUM in `src/lib/rbac.ts`. Adding a
 *     capability requires a code change + migration; you cannot
 *     INSERT a row with an unknown capability via API.
 *   - `partner` ALWAYS has every capability. The server seed enforces
 *     this; the `requireCapability()` helper short-circuits for partners.
 *     The UI also prevents editing partner rows.
 *   - Every grant/revoke is audit-logged (the trigger on this table
 *     writes to `audit_log`).
 *
 * Capability text values are validated by the server actions against
 * the `CAPABILITIES` const in `lib/rbac.ts`. We don't model it as a
 * pgEnum because adding capabilities is more frequent than adding
 * roles and pgEnum migrations are awkward.
 */
export const roleCapabilities = pgTable(
  'role_capabilities',
  {
    ...timestamps(),
    ...auditColumns(),
    role: userRoleEnum().notNull(),
    capability: text().notNull(),
    granted: boolean().notNull().default(false),
  },
  (t) => [
    uniqueIndex('role_capabilities_role_capability_unique').on(t.role, t.capability),
    index().on(t.role),
    index().on(t.capability),
  ],
);

export type RoleCapability = typeof roleCapabilities.$inferSelect;
export type NewRoleCapability = typeof roleCapabilities.$inferInsert;
