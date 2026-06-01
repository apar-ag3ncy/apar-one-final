import { bigint, index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';

export const documentBucketEnum = pgEnum('document_bucket', [
  'public-docs',
  'internal-docs',
  'restricted-docs',
  'restricted-kyc',
]);

export const documentVisibilityEnum = pgEnum('document_visibility', [
  'public',
  'internal',
  'restricted',
  'kyc',
]);

/**
 * Polymorphic attachment table. `entityType` + `entityId` together identify
 * what the document belongs to (clients, vendors, projects, employees, etc.).
 * Cross-schema FK is not enforced; integrity is upheld by the service layer.
 *
 * KYC docs go to bucket `restricted-kyc` ONLY (CLAUDE.md rule #26). Every
 * access of restricted docs gets a row in `document_access_log` — added in a
 * later migration alongside the documents service.
 */
export const documents = pgTable(
  'documents',
  {
    ...timestamps(),
    ...auditColumns(),
    entityType: text().notNull(),
    entityId: uuid().notNull(),
    bucket: documentBucketEnum().notNull(),
    storagePath: text().notNull(),
    visibility: documentVisibilityEnum().notNull(),
    category: text(),
    originalFilename: text().notNull(),
    mimeType: text().notNull(),
    sizeBytes: bigint({ mode: 'number' }).notNull(),
  },
  (t) => [index().on(t.entityType, t.entityId), index().on(t.bucket), index().on(t.visibility)],
);
