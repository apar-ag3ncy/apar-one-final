import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { documents } from './documents';

/**
 * Invoice themes — the visual skin applied to a generated invoice PDF.
 *
 * Two kinds:
 *   - `builtin`  — shipped/seeded themes (Modern, Classic, Minimal). No
 *     source document; colours/font are authored in the seed migration.
 *   - `docx`     — uploaded by an admin. The original `.docx` is stored as
 *     a `documents` row (`sourceDocumentId`) and a few design tokens
 *     (theme colours, a font family, the first embedded logo) are
 *     extracted at upload time and persisted here. We do NOT reproduce the
 *     Word layout — react-pdf renders the invoice; the theme only supplies
 *     brand tokens that overlay the existing template.
 *
 * Global scope: themes are app-wide and admin-managed (no per-client
 * scoping in v1). Exactly one theme may be the default at a time, enforced
 * by the partial-unique index below.
 *
 * No money lives here, so `db:check` / `check:money` are unaffected.
 */
export const invoiceThemeKindEnum = pgEnum('invoice_theme_kind', ['builtin', 'docx']);

export const invoiceThemes = pgTable(
  'invoice_themes',
  {
    ...timestamps(),
    ...auditColumns(),
    name: text().notNull(),
    kind: invoiceThemeKindEnum().notNull(),
    isDefault: boolean().notNull().default(false),

    // The uploaded `.docx` (kind='docx') and the extracted logo image, both
    // stored as polymorphic `documents` rows. Null for builtin themes.
    sourceDocumentId: uuid().references(() => documents.id, { onDelete: 'set null' }),
    logoDocumentId: uuid().references(() => documents.id, { onDelete: 'set null' }),

    // Design tokens overlaid onto the react-pdf template. Hex strings.
    primaryColor: text(),
    secondaryColor: text(),
    accentColor: text(),
    // Must resolve to a react-pdf built-in family (Helvetica/Times-Roman/
    // Courier) — arbitrary DOCX fonts can't render without bundling a .ttf.
    fontFamily: text(),
    headerText: text(), // overrides the default 'TAX INVOICE' banner
    footerText: text(), // overrides the default computer-generated footer

    // Forward-compatible bag for additional extracted tokens (raw font name,
    // logo content-type, all clrScheme entries, etc.).
    tokens: jsonb().notNull().default({}),
  },
  (t) => [
    index().on(t.kind),
    // At most one default theme at a time (ignoring soft-deleted rows).
    uniqueIndex('invoice_themes_single_default')
      .on(t.isDefault)
      .where(sql`${t.isDefault} AND ${t.deletedAt} IS NULL`),
  ],
);

export type InvoiceTheme = typeof invoiceThemes.$inferSelect;
export type NewInvoiceTheme = typeof invoiceThemes.$inferInsert;
