import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { entityRelationshipKindEnum, entityTypeEnum } from './_polymorphic';

/**
 * Polymorphic edge table — both ends are (entity_type, entity_id).
 * Drives the AUDIT-GAPS §4.3 "right rail of related entities" and the
 * SPEC-AMENDMENT-001 §7.3 "Related" tab on every profile.
 *
 * `kind` keeps the relationship typed (see `entityRelationshipKindEnum`).
 * `fromEntityType/Id` is the subject; `toEntityType/Id` is the object —
 * e.g. for "vendor X introduced by client Y":
 *   fromEntityType='vendor', fromEntityId=X,
 *   kind='introduced_by',
 *   toEntityType='client', toEntityId=Y.
 *
 * Computed-related views (SPEC-AMENDMENT-001 §7.3) are derived from
 * transactions, not this table. This table is for *explicit* relationships
 * the user records.
 */
export const entityRelationships = pgTable(
  'entity_relationships',
  {
    ...timestamps(),
    ...auditColumns(),
    fromEntityType: entityTypeEnum().notNull(),
    fromEntityId: uuid().notNull(),
    kind: entityRelationshipKindEnum().notNull(),
    toEntityType: entityTypeEnum().notNull(),
    toEntityId: uuid().notNull(),
    notes: text(),
  },
  (t) => [
    index().on(t.fromEntityType, t.fromEntityId),
    index().on(t.toEntityType, t.toEntityId),
    index().on(t.kind),
  ],
);

export type EntityRelationship = typeof entityRelationships.$inferSelect;
export type NewEntityRelationship = typeof entityRelationships.$inferInsert;
