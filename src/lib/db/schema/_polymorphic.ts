import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Shared polymorphic-entity enum. Every `entity_contacts`,
 * `entity_addresses`, `entity_bank_accounts`, `entity_tax_identifiers`,
 * `entity_documents`, `entity_relationships`, `entity_custom_values`,
 * `entity_activity_log` row carries one of these in its `entity_type`
 * column.
 *
 * **Closed enum in code.** AUDIT-GAPS §3 forbids free-text entity types
 * for the same reason it forbids free-text capabilities: a second permission
 * system masquerading as data is harder to reason about than an enum.
 *
 * Adding a new entity type: add the literal here, ship a migration that
 * `ALTER TYPE entity_type ADD VALUE 'foo'`, then update the deferred
 * polymorphic-CHECK trigger (`_polymorphic_check.sql`).
 */
export const entityTypeEnum = pgEnum('entity_type', [
  'client',
  'vendor',
  'employee',
  'project',
  'office',
]);

export type EntityType = (typeof entityTypeEnum.enumValues)[number];

/**
 * Shared contract-status enum for principal entities. AUDIT-GAPS §1.3:
 * creation is gated by document signing. "Waived" exists for legacy
 * backfill (per the backend-audit confirmed-default #2 — legacy-only).
 */
export const contractStatusEnum = pgEnum('contract_status', ['signed', 'pending', 'waived']);

/**
 * Polymorphic relationship kind for `entity_relationships`. Closed enum;
 * add a value via migration if a real need arises.
 *   - `introduced_by` — vendor was introduced via client X
 *   - `account_manager_of` — employee is AM for client X
 *   - `expense_on_behalf` — expense from vendor on behalf of client
 *   - `mentor_of` / `reports_to` — employee org structure
 *   - `subcontractor_of` — vendor under another vendor
 */
export const entityRelationshipKindEnum = pgEnum('entity_relationship_kind', [
  'introduced_by',
  'account_manager_of',
  'expense_on_behalf',
  'mentor_of',
  'reports_to',
  'subcontractor_of',
]);
