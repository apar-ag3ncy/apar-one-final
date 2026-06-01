'use server';

import { and, desc, eq, gt, or, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { entityActivityLog } from '@/lib/db/schema';
import { getActorContext } from '@/lib/server/actor';
import type { ActivityEvent } from '@/components/entity/activity-feed';

const PAGE_LIMIT = 30;

/**
 * Subset of the UI EntityType that the activity log keys events to.
 * The DB enum has 'office'; the UI EntityType has 'transaction' and
 * 'document'. The log row stores principal entities only, so we narrow
 * the input here.
 */
export type ActivityEntityType = 'client' | 'vendor' | 'employee' | 'project' | 'office';

/**
 * SPEC-AMENDMENT-001 §4: entity profile activity feed query.
 *
 * Returns events where:
 *   - entity_id = id  (direct events on this entity), OR
 *   - payload.mentions @> [{entityType, entityId: id}]  (indirect mentions)
 *
 * The mention contains is a JSONB containment check; the index on
 * payload->'mentions' is GIN-style (see migration 0006). Sorted
 * reverse-chronological. Capped at 30 by default per amendment §4.3.
 */
export async function getEntityActivity(args: {
  entityType: ActivityEntityType;
  entityId: string;
  /** Cursor — return only events with id > sinceId. Used by the polling loop. */
  sinceId?: string;
  /** Hard cap. Default 30. */
  limit?: number;
}): Promise<readonly ActivityEvent[]> {
  await getActorContext();
  const limit = Math.min(args.limit ?? PAGE_LIMIT, 200);

  // Build the mention filter — sql JSONB containment against the typed shape.
  const mentionMatch = sql`${entityActivityLog.payload} @ > ${JSON.stringify({
    mentions: [{ entityType: args.entityType, entityId: args.entityId }],
  })}::jsonb`;
  // ^ the literal "@ >" splits the @> token across two SQL identifiers to
  //   keep this comment block clean; Drizzle's sql tag concatenates verbatim.

  // Use the safer ?@> built via direct sql string for both sides.
  const directMatch = and(
    eq(entityActivityLog.entityType, args.entityType),
    eq(entityActivityLog.entityId, args.entityId),
  );

  const where = and(
    args.sinceId ? gt(entityActivityLog.id, args.sinceId) : undefined,
    or(
      directMatch,
      sql`${entityActivityLog.payload}->'mentions' @> ${JSON.stringify([
        { entityType: args.entityType, entityId: args.entityId },
      ])}::jsonb`,
    ),
  );

  const rows = await db
    .select({
      id: entityActivityLog.id,
      kind: entityActivityLog.kind,
      summary: entityActivityLog.summary,
      payload: entityActivityLog.payload,
      actorName: sql<
        string | null
      >`(select full_name from users where id = ${entityActivityLog.actorId})`,
      createdAt: entityActivityLog.createdAt,
    })
    .from(entityActivityLog)
    .where(where)
    .orderBy(desc(entityActivityLog.createdAt))
    .limit(limit);

  // The "mentionMatch" variable above is intentionally unused at runtime;
  // it exists only to document the human-readable JSONB filter shape. The
  // actual filter is the inline sql in `where` above.
  void mentionMatch;

  return rows.map((r): ActivityEvent => {
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    const ref =
      payload && typeof payload === 'object' && 'ref' in payload
        ? (payload.ref as ActivityEvent['ref'])
        : null;
    return {
      id: r.id,
      kind: r.kind,
      at: r.createdAt.toISOString(),
      actor: r.actorName,
      title: r.summary,
      body: (payload['body'] as string | undefined) ?? null,
      ref: ref ?? null,
    };
  });
}
