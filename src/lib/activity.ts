import 'server-only';

import { sql } from 'drizzle-orm';

import { db, type DbClient } from './db/client';
import type { EntityType } from './db/schema/_polymorphic';
import {
  EVENT_REGISTRY,
  EVENT_REGISTRY_SET,
  type EventKind,
} from './db/schema/entity_activity_log';

/**
 * Typed event stream writer. Writes to `entity_activity_log` (append-only,
 * RLS-locked via 0005). The closed event-kind enum lives in
 * `db/schema/entity_activity_log.ts` so it can be shared between the
 * server-only writer (this file) and the schema layer (the pg-enum
 * `event_kind` is defined from the same tuple). Re-exporting here keeps the
 * existing import surface `from '@/lib/activity'` stable.
 */

export { EVENT_REGISTRY, EVENT_REGISTRY_SET };
export type { EventKind };

export type ActivityMention = {
  entityType: EntityType | string;
  entityId: string;
};

export type ActivityEntry = {
  entityType: EntityType | string;
  entityId: string;
  actorId: string | null;
  kind: EventKind;
  summary: string;
  payload?: Record<string, unknown> & { mentions?: ActivityMention[] };
  isAchievement?: boolean;
};

/**
 * Write a typed activity event. Validates the kind against the registry
 * to catch typos before the row is written.
 */
export async function logActivity(entry: ActivityEntry, client: DbClient = db): Promise<void> {
  if (!EVENT_REGISTRY_SET.has(entry.kind)) {
    throw new Error(`logActivity: unknown event kind "${entry.kind}". Add it to EVENT_REGISTRY.`);
  }
  const payload = entry.payload ?? {};
  await client.execute(sql`
    INSERT INTO entity_activity_log
      (entity_type, entity_id, actor_id, kind, summary, payload, is_achievement)
    VALUES
      (${entry.entityType}, ${entry.entityId}, ${entry.actorId},
       ${entry.kind}, ${entry.summary}, ${JSON.stringify(payload)}::jsonb,
       ${entry.isAchievement ?? false})
  `);
}
