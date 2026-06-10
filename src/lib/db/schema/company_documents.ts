import { bigint, index, pgEnum, pgTable, text } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { bytea } from './_custom';

/**
 * Company-document categories surfaced in Settings → Company details. The
 * statutory ones (gst/tan/pan/udyam) double as a place to attach the scan of
 * the matching certificate; `rent_agreement` / `partnership_deed` /
 * `incorporation` are the named legal docs from the brief; `other` is the
 * free catch-all where the reference number is typed in manually.
 */
export const companyDocumentCategoryEnum = pgEnum('company_document_category', [
  'gst',
  'tan',
  'pan',
  'udyam',
  'incorporation',
  'partnership_deed',
  'rent_agreement',
  'other',
]);

/**
 * Apār's own documents (certificates, deeds, rent agreements, …). The file
 * bytes live inline in Postgres (`data` bytea) because the app runs against
 * vanilla local Postgres with no Supabase Storage; these are agency-owned,
 * non-KYC documents meant to be downloaded/viewed, so inline storage is the
 * portable choice. Served by the `/settings/company/documents/[id]` route
 * handler (inline view or `?download=1` attachment).
 *
 * `referenceNumber` is the "add the number manually while uploading" field —
 * e.g. the GSTIN on the GST certificate, the agreement number on a rent deed.
 */
export const companyDocuments = pgTable(
  'company_documents',
  {
    ...timestamps(),
    ...auditColumns(),
    category: companyDocumentCategoryEnum().notNull(),
    title: text().notNull(),
    /** Manually-entered number/reference for this document (optional). */
    referenceNumber: text(),
    originalFilename: text().notNull(),
    mimeType: text().notNull(),
    sizeBytes: bigint({ mode: 'number' }).notNull(),
    /** The file itself. Never SELECT this except in the download route. */
    data: bytea().notNull(),
    notes: text(),
  },
  (t) => [index().on(t.category)],
);

export type CompanyDocument = typeof companyDocuments.$inferSelect;
export type NewCompanyDocument = typeof companyDocuments.$inferInsert;
