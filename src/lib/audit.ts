import 'server-only';

import { sql } from 'drizzle-orm';

import { db, type DbClient } from './db/client';
import type { EntityType } from './db/schema/_polymorphic';

/**
 * Diff-trail logger. Writes to `audit_log` (the table from migration 0002).
 * CLAUDE rule #38 says "trigger-populated"; the Phase 3 trigger will cover
 * the common case (mutations via Drizzle). This helper is for paths that
 * write directly via Supabase JS (e.g., storage events) or for events the
 * trigger can't see (KYC reveal, signed-URL minting).
 *
 * Append-only at the RLS layer — no UPDATE / DELETE path. Idempotency:
 * the caller is responsible for not double-writing; the table doesn't
 * have a natural dedup key.
 */
export type AuditAction =
  | 'insert'
  | 'update'
  | 'delete'
  | 'reveal_kyc'
  | 'reveal_bank'
  | 'store_bank'
  | 'upload_kyc'
  | 'sign_url'
  | 'capability_grant'
  | 'capability_revoke'
  | 'login'
  | 'logout';

export type AuditEntry = {
  actorId: string | null;
  entityType: EntityType | string;
  entityId: string;
  action: AuditAction;
  changes: Record<string, unknown>;
};

export async function logAudit(entry: AuditEntry, client: DbClient = db): Promise<void> {
  await client.execute(sql`
    INSERT INTO audit_log
      (actor_id, entity_type, entity_id, action, changes)
    VALUES
      (${entry.actorId}, ${entry.entityType}, ${entry.entityId},
       ${entry.action}, ${JSON.stringify(entry.changes)}::jsonb)
  `);
}
