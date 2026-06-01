import { bigint, date, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';

/**
 * Reference rates / thresholds per TDS section, FY-bounded. **Used
 * for warnings only** — CLAUDE rule #2: Apār never auto-computes TDS.
 * The validation rule `tds_threshold_crossed` (warn) checks
 * cumulative payments per vendor per FY against `thresholdFyPaise`
 * and warns when crossed without TDS deducted.
 *
 * Section codes are statutory text. Seeded in 0019:
 *
 *   192     — Salary (variable; rate computed per slab — no default)
 *   194C    — Contractors (individual 1% / company 2%; single >= 30k, FY >= 1L)
 *   194J    — Professional / technical services (10%, FY >= 50k from 2025-04-01)
 *   194I-b  — Rent of building (10%)
 *   194I-p  — Rent of plant/equipment (2%)
 *   194H    — Commission / brokerage (5%)
 *   194Q    — Purchase of goods (0.1%; high turnover only)
 *
 * Effective-from / effective-to allow superseding when the Finance Act
 * changes a rate (e.g. 194J cut from 10% in some prior year, then
 * reinstated 2025-04-01). Lookup picks the row where
 * `effective_from_date <= invoice_date AND (effective_to_date IS NULL OR
 * invoice_date < effective_to_date)`.
 */
export const tdsReferenceSections = pgTable(
  'tds_reference_sections',
  {
    ...timestamps(),
    ...auditColumns(),
    sectionCode: text().notNull(), // '194J', '194I-b', etc.
    description: text().notNull(),

    /** Rates in basis points. NULL = no default (variable / per-slab, e.g. 192). */
    defaultRateBpsIndividual: integer(),
    defaultRateBpsCompany: integer(),

    /** Thresholds in paise. NULL = no threshold defined. */
    thresholdSinglePaise: bigint({ mode: 'bigint' }),
    thresholdFyPaise: bigint({ mode: 'bigint' }),

    effectiveFromDate: date().notNull(),
    effectiveToDate: date(),

    /** Free-text notes about modifiers — e.g. "no TDS if PAN missing → 20%
     *  per §206AA", "lower-deduction certificate under §197 overrides". */
    payerTypeModifierNotes: text(),
  },
  (t) => [
    uniqueIndex('tds_reference_sections_code_effective_from_unique').on(
      t.sectionCode,
      t.effectiveFromDate,
    ),
    index().on(t.effectiveFromDate, t.effectiveToDate),
    index().on(t.sectionCode),
  ],
);

export type TdsReferenceSection = typeof tdsReferenceSections.$inferSelect;
export type NewTdsReferenceSection = typeof tdsReferenceSections.$inferInsert;
