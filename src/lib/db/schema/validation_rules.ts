import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';

export const validationSeverityEnum = pgEnum('validation_severity', ['info', 'warn', 'block']);

/**
 * Validation rule registry. LEDGER-SPEC §1.6 + §4.
 *
 * v1 seeds 8 rules; 3 are enabled by default
 * (`document_missing`, `external_ref_clash`,
 * `client_attribution_missing`). Settings UI in Phase 2 lets partner
 * toggle and reconfigure via `config jsonb`.
 *
 * The engine in `lib/server/ledger/validation.ts` runs enabled rules
 * during `createDraftTransaction` and `postTransaction`. `block`
 * throws; `warn` / `info` attach to the transaction's
 * `validation_flags`.
 */
export const validationRules = pgTable(
  'validation_rules',
  {
    ...timestamps(),
    ...auditColumns(),
    code: text().notNull(),
    description: text().notNull(),
    isEnabled: boolean().notNull().default(false),
    config: jsonb().notNull().default({}),
    severity: validationSeverityEnum().notNull(),
  },
  (t) => [uniqueIndex('validation_rules_code_unique').on(t.code)],
);

export type ValidationRule = typeof validationRules.$inferSelect;
export type NewValidationRule = typeof validationRules.$inferInsert;

export const taxRateKindEnum = pgEnum('tax_rate_kind', ['gst', 'tds', 'other']);

/**
 * Reference rates table. LEDGER-SPEC §1.6.
 *
 * Drives the validation rules' "captured rate vs reference rate"
 * comparison. **Apar does NOT compute amounts from these rates.**
 * (CLAUDE rule #2, LEDGER-SPEC §0.7.) Reference rates only generate
 * warnings.
 *
 * Stored as `rate_bps` (basis points; 18% = 1800, 10% = 1000). FY-bounded
 * via `effective_from` / `effective_to`. The TDS sections from the
 * agent-backend prompt header (192/194C/194J/194I/194H/194Q) seed here
 * as disabled.
 */
export const taxReferenceRates = pgTable(
  'tax_reference_rates',
  {
    ...timestamps(),
    ...auditColumns(),
    kind: taxRateKindEnum().notNull(),
    code: text().notNull(), // 'GST_SERVICE_STD', 'TDS_194J'
    description: text().notNull(),
    rateBps: integer().notNull(),
    effectiveFrom: date().notNull(),
    effectiveTo: date(),
    statutorySection: text(),
    isEnabled: boolean().notNull().default(false),
    metadata: jsonb().notNull().default({}),
  },
  (t) => [
    uniqueIndex('tax_reference_rates_code_effective_from_unique').on(t.code, t.effectiveFrom),
    index().on(t.kind),
    index().on(t.effectiveFrom, t.effectiveTo),
    index().on(t.isEnabled),
  ],
);

export type TaxReferenceRate = typeof taxReferenceRates.$inferSelect;
export type NewTaxReferenceRate = typeof taxReferenceRates.$inferInsert;
