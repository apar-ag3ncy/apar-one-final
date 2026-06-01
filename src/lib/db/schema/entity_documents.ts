import { boolean, date, index, integer, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { documents } from './documents';
import { entityTypeEnum } from './_polymorphic';

export const documentKindEnum = pgEnum('document_kind', [
  // Contracts / legal
  'contract',
  'msa',
  'sow',
  'nda',
  'offer_letter',
  'separation_letter',
  // KYC / identity
  'kyc_pan',
  'kyc_aadhaar',
  'kyc_passport',
  'kyc_voter_id',
  'kyc_driving_license',
  'cancelled_cheque',
  'bank_statement',
  // Financial
  'invoice', // our invoice TO a client OR a vendor's invoice TO us
  'receipt',
  'payslip',
  'salary_sheet',
  'reimbursement_receipt',
  'expense_receipt',
  // Other
  'photo',
  'other',
]);

export const documentStatusEnum = pgEnum('document_status', [
  'active',
  'superseded',
  'expired',
  'soft_deleted',
]);

/**
 * Typed link layer over `documents` (the storage-ref base). One row
 * per (entity, document) pairing with kind / signed dates / version /
 * supersedes chain.
 *
 * Versioning (SPEC-AMENDMENT-001 §10):
 *   - v1 uploaded → row with `version=1`, `status='active'`
 *   - v2 uploaded → new row with `version=2`, `supersedesId=<v1.id>`,
 *     and the v1 row flips to `status='superseded'`
 *   - Soft delete → `status='soft_deleted'`. File stays in storage.
 *   - Hard delete → partner + dependents check (no posted txn references)
 *
 * `documents` itself stores the file reference, mime, bucket, storage
 * path. This table is the typed metadata + version chain.
 */
export const entityDocuments = pgTable(
  'entity_documents',
  {
    ...timestamps(),
    ...auditColumns(),
    entityType: entityTypeEnum().notNull(),
    entityId: uuid().notNull(),
    documentId: uuid()
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),

    kind: documentKindEnum().notNull(),
    title: text(),
    description: text(),

    // Signing (contract docs)
    signedByUs: boolean().notNull().default(false),
    signedByThem: boolean().notNull().default(false),
    signedAt: date(),
    expiresAt: date(),

    // Versioning chain
    version: integer().notNull().default(1),
    supersedesId: uuid(), // self-FK added in migration

    status: documentStatusEnum().notNull().default('active'),
    notes: text(),
  },
  (t) => [
    index().on(t.entityType, t.entityId),
    index().on(t.documentId),
    index().on(t.kind),
    index().on(t.status),
    index().on(t.supersedesId),
  ],
);

export type EntityDocument = typeof entityDocuments.$inferSelect;
export type NewEntityDocument = typeof entityDocuments.$inferInsert;
