import {
  bigint,
  char,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { clients } from './clients';
import { documents } from './documents';
import { entityDocuments } from './entity_documents';
import { projects } from './projects';

/**
 * Quotes / estimates (Apār → client). Mirrors `invoices` structurally
 * but with its own state machine and an acceptance-doc link. Converts
 * to one or more invoices via `estimate_invoice_links`.
 *
 * Acceptance flow: client signs and returns a doc. The accountant
 * uploads it via the standard `uploadDocument` flow (creates a
 * `documents` row + `entity_documents` typed-metadata row), then
 * `acceptanceDocId` links the estimate to that signed file.
 *
 * State transitions:
 *   draft → sent → accepted | rejected | expired
 *   accepted → converted (set automatically when sum of conversions = total)
 */
export const estimateStateEnum = pgEnum('estimate_state', [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'converted',
]);

export const estimates = pgTable(
  'estimates',
  {
    ...timestamps(),
    ...auditColumns(),
    documentNumber: text().notNull(),
    documentDate: date().notNull(),
    validTillDate: date(),
    financialYearStart: date().notNull(),
    clientId: uuid()
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    projectId: uuid().references(() => projects.id, { onDelete: 'restrict' }),
    state: estimateStateEnum().notNull().default('draft'),

    subtotalPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    capturedTaxTotalPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    capturedTotalPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    placeOfSupply: char({ length: 2 }),
    capturedTaxSplit: jsonb().notNull().default({}),

    terms: text(),
    notes: text(),

    idempotencyKey: text().notNull(),
    sentAt: timestamp({ withTimezone: true }),
    acceptedAt: timestamp({ withTimezone: true }),
    rejectedAt: timestamp({ withTimezone: true }),

    sourceDocumentId: uuid().references(() => documents.id, { onDelete: 'set null' }),
    acceptanceDocId: uuid().references(() => entityDocuments.id, { onDelete: 'set null' }),

    validationFlags: jsonb().notNull().default([]),
  },
  (t) => [
    uniqueIndex('estimates_document_number_per_fy_unique').on(
      t.financialYearStart,
      t.documentNumber,
    ),
    uniqueIndex('estimates_idempotency_key_unique').on(t.idempotencyKey),
    index().on(t.clientId, t.documentDate.desc()),
    index().on(t.projectId),
    index().on(t.state),
    index().on(t.validTillDate),
  ],
);

export type Estimate = typeof estimates.$inferSelect;
export type NewEstimate = typeof estimates.$inferInsert;
