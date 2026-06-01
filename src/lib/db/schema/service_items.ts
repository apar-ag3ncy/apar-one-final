import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';

/**
 * Service catalog (SAC-coded). The invoice / estimate line picker
 * snaps to entries here and pre-fills description / rate / default
 * GST rate / posting account, but each line can still override every
 * field — the catalog drives suggestions, never authoritative captured
 * values (CLAUDE rule #2).
 *
 * Apār is a pure-services agency so all entries are SAC, not HSN.
 * Common SACs worth seeding eventually: 998361 (advertising services),
 * 998391 (specialty design — branding / graphic), 998311 (management
 * consulting), 998363 (purchase/sale of advertising space), 998399
 * (other professional / business services). v1 ships empty — the
 * accountant adds entries as they appear.
 *
 * Soft-deleted via `deletedAt` per `_shared.timestamps()`. Archiving a
 * service item just hides it from the picker — historical invoice
 * lines keep their snapshot of description / sacCode so reports don't
 * mutate.
 */
export const serviceItems = pgTable(
  'service_items',
  {
    ...timestamps(),
    ...auditColumns(),
    /** SAC code — 4 to 8 digits per CBIC Notification 78/2020. Stored
     *  as text to preserve leading zeros and the user's chosen
     *  precision. */
    sacCode: text().notNull(),
    name: text().notNull(),
    description: text(),

    /** Default unit rate in paise. Optional — some services price per
     *  proposal rather than per unit. bigint to keep money out of
     *  numeric / float (db:check guards this). */
    defaultRatePaise: bigint({ mode: 'bigint' }),
    /** Free-text unit label: 'hour', 'day', 'month', 'campaign'. */
    defaultUnit: text(),

    /** Income account code this service usually credits. Defaults to
     *  '4100' (Service Revenue); accountant can point it at '4200'
     *  (Reimbursement Income) for pure pass-throughs. Stored as a text
     *  code to mirror `invoice_lines.postingAccountCode` — the line
     *  pre-fills from here and remains overridable. */
    defaultPostingAccountCode: text().notNull().default('4100'),

    /** Reference GST rate in basis points (1800 = 18%). Used by the
     *  rate-mismatch validation warning when the line's captured rate
     *  diverges by >50bps. Never authoritative. */
    defaultGstRateBps: integer().notNull().default(1800),

    /** TDS section the buyer is likely to deduct under — '194C' for ad
     *  production, '194J' for pure strategy / consulting. Captured here
     *  as a hint shown on the line; the receipt captures the actual
     *  deducted amount. */
    defaultTdsSection: text(),

    isActive: boolean().notNull().default(true),
  },
  (t) => [
    // Multiple catalog entries can share an SAC (two flavours of
    // advertising at different default rates); `name` is the human
    // disambiguator and is unique.
    uniqueIndex('service_items_name_unique').on(t.name),
    index().on(t.sacCode),
    index().on(t.isActive),
  ],
);

export type ServiceItem = typeof serviceItems.$inferSelect;
export type NewServiceItem = typeof serviceItems.$inferInsert;
