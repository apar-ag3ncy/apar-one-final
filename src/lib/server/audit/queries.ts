'use server';

import { and, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { auditLog } from '@/lib/db/schema/audit_log';
import { entityActivityLog } from '@/lib/db/schema/entity_activity_log';
import { users } from '@/lib/db/schema/users';
import { getActorContext } from '@/lib/server/actor';

/**
 * Audit log queries. Backs the `/audit` page + OS audit window.
 *
 * Two streams:
 *
 *   - `listAuditLog()` — every INSERT/UPDATE/DELETE on watched tables, with
 *     a JSON diff in `changes`. Trigger-populated; append-only RLS already
 *     blocks UPDATE/DELETE per `drizzle/0002_audit_log_append_only.sql`.
 *   - `listActivityLog()` — typed event stream (`entity_activity_log`),
 *     51+ event kinds defined in the schema. Lower-cardinality, higher-
 *     readability ("Aakash created the client", "Vendor bill ₹35,400
 *     recorded"). Both come back via the same filter shape so the page can
 *     toggle between them.
 *
 * Both queries are pure SELECT and capability-free for now. Production
 * should gate `/audit` behind `view_audit_log` (already in the RBAC
 * registry); the page component decides whether to surface a 403.
 */

export type AuditFilter = {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  /** Inclusive YYYY-MM-DD. */
  fromDate?: string;
  /** Exclusive YYYY-MM-DD (caller adds 1 day for inclusive end). */
  toDate?: string;
  limit?: number;
  /** ISO timestamp from the previous page's last row. */
  cursor?: string;
};

export type AuditLogRow = {
  id: string;
  createdAt: Date;
  actorId: string | null;
  actorName: string | null;
  entityType: string;
  entityId: string;
  action: string;
  changes: Record<string, unknown>;
};

export type ActivityLogRow = {
  id: string;
  createdAt: Date;
  actorId: string | null;
  actorName: string | null;
  entityType: string;
  entityId: string;
  kind: string;
  summary: string | null;
  payload: Record<string, unknown> | null;
};

const DEFAULT_LIMIT = 50;

export async function listAuditLog(filter: AuditFilter = {}): Promise<readonly AuditLogRow[]> {
  await getActorContext();
  const limit = Math.min(filter.limit ?? DEFAULT_LIMIT, 200);
  const conds = [] as Array<ReturnType<typeof eq>>;
  if (filter.entityType) conds.push(eq(auditLog.entityType, filter.entityType));
  if (filter.entityId) conds.push(eq(auditLog.entityId, filter.entityId));
  if (filter.actorId) conds.push(eq(auditLog.actorId, filter.actorId));
  if (filter.fromDate) conds.push(gte(auditLog.createdAt, sql`${filter.fromDate}::timestamptz`));
  if (filter.toDate) conds.push(lte(auditLog.createdAt, sql`${filter.toDate}::timestamptz`));
  if (filter.cursor) conds.push(lt(auditLog.createdAt, sql`${filter.cursor}::timestamptz`));

  const rows = await db
    .select({
      id: auditLog.id,
      createdAt: auditLog.createdAt,
      actorId: auditLog.actorId,
      actorName: users.fullName,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      action: auditLog.action,
      changes: auditLog.changes,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);

  return rows.map(
    (r): AuditLogRow => ({
      id: r.id,
      createdAt: r.createdAt,
      actorId: r.actorId,
      actorName: r.actorName ?? null,
      entityType: r.entityType,
      entityId: r.entityId,
      action: r.action,
      changes: (r.changes ?? {}) as Record<string, unknown>,
    }),
  );
}

export async function listActivityLog(
  filter: AuditFilter = {},
): Promise<readonly ActivityLogRow[]> {
  await getActorContext();
  const limit = Math.min(filter.limit ?? DEFAULT_LIMIT, 200);
  const conds = [] as Array<ReturnType<typeof eq>>;
  // entity_activity_log.entityType is a Postgres enum restricted to
  // client/vendor/employee/project/office. Cast through the SQL helper
  // so we can accept the same filter shape as the diff trail (which is
  // text-typed) without splitting the public API.
  if (filter.entityType)
    conds.push(sql`${entityActivityLog.entityType}::text = ${filter.entityType}`);
  if (filter.entityId) conds.push(eq(entityActivityLog.entityId, filter.entityId));
  if (filter.actorId) conds.push(eq(entityActivityLog.actorId, filter.actorId));
  if (filter.fromDate)
    conds.push(gte(entityActivityLog.createdAt, sql`${filter.fromDate}::timestamptz`));
  if (filter.toDate)
    conds.push(lte(entityActivityLog.createdAt, sql`${filter.toDate}::timestamptz`));
  if (filter.cursor)
    conds.push(lt(entityActivityLog.createdAt, sql`${filter.cursor}::timestamptz`));

  const rows = await db
    .select({
      id: entityActivityLog.id,
      createdAt: entityActivityLog.createdAt,
      actorId: entityActivityLog.actorId,
      actorName: users.fullName,
      entityType: entityActivityLog.entityType,
      entityId: entityActivityLog.entityId,
      kind: entityActivityLog.kind,
      summary: entityActivityLog.summary,
      payload: entityActivityLog.payload,
    })
    .from(entityActivityLog)
    .leftJoin(users, eq(users.id, entityActivityLog.actorId))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(entityActivityLog.createdAt))
    .limit(limit);

  return rows.map(
    (r): ActivityLogRow => ({
      id: r.id,
      createdAt: r.createdAt,
      actorId: r.actorId,
      actorName: r.actorName ?? null,
      entityType: r.entityType,
      entityId: r.entityId,
      kind: r.kind,
      summary: r.summary ?? null,
      payload: (r.payload ?? null) as Record<string, unknown> | null,
    }),
  );
}
