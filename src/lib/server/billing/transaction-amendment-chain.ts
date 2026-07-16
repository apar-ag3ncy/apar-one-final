// Shared amendment-chain walker for posted transactions (§7.2), used by both
// client receipts and vendor payments. A plain server helper (NOT 'use server')
// so it can export a type + a reusable async function to both 'use server'
// billing modules. Mirrors getInvoiceAmendmentChain.

import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { auditLog } from '@/lib/db/schema';

export type TransactionAmendmentChainEntry = {
  transactionId: string;
  /** Human label — the receipt/voucher number, else the external ref. */
  label: string;
  txnDate: string;
  status: string;
  amountPaise: string;
  /** The live (non-reversed) tip of the chain. */
  isCurrent: boolean;
  /** Reason captured when THIS version was reissued (null for the original). */
  reason: string | null;
};

type ChainNode = {
  id: string;
  external_ref: string;
  txn_date: string;
  status: string;
  amount: string;
  amended_from: string | null;
};

async function fetchById(id: string): Promise<ChainNode | null> {
  const rows = await db.execute<ChainNode>(sql`
    SELECT
      t.id::text AS id,
      t.external_ref,
      t.txn_date::text AS txn_date,
      t.status::text AS status,
      t.amended_from_transaction_id::text AS amended_from,
      COALESCE((
        SELECT SUM(p.amount_paise) FROM postings p
        WHERE p.transaction_id = t.id AND p.side = 'debit'
      ), 0)::text AS amount
    FROM transactions t WHERE t.id = ${id} LIMIT 1
  `);
  return (Array.isArray(rows) ? rows : [])[0] ?? null;
}

async function fetchChild(id: string): Promise<ChainNode | null> {
  const rows = await db.execute<ChainNode>(sql`
    SELECT
      t.id::text AS id,
      t.external_ref,
      t.txn_date::text AS txn_date,
      t.status::text AS status,
      t.amended_from_transaction_id::text AS amended_from,
      COALESCE((
        SELECT SUM(p.amount_paise) FROM postings p
        WHERE p.transaction_id = t.id AND p.side = 'debit'
      ), 0)::text AS amount
    FROM transactions t WHERE t.amended_from_transaction_id = ${id} LIMIT 1
  `);
  return (Array.isArray(rows) ? rows : [])[0] ?? null;
}

/**
 * Walk the amendment chain for a posted transaction in both directions
 * (amended_from backward to the root, forward to the tip), oldest→newest. The
 * `label` fn maps a node's external ref to a human number; `reason` per version
 * comes from the audit trail (entity_type='transactions', action='insert').
 */
export async function transactionAmendmentChain(
  transactionId: string,
  label: (externalRef: string) => string,
): Promise<TransactionAmendmentChainEntry[]> {
  const CAP = 50;
  const start = await fetchById(transactionId);
  if (!start) return [];
  const seen = new Set<string>([start.id]);

  const back: ChainNode[] = [start];
  let cursor: ChainNode = start;
  while (back.length < CAP && cursor.amended_from) {
    const parent = await fetchById(cursor.amended_from);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    back.push(parent);
    cursor = parent;
  }
  back.reverse();

  const fwd: ChainNode[] = [];
  cursor = start;
  while (back.length + fwd.length < CAP) {
    const child = await fetchChild(cursor.id);
    if (!child || seen.has(child.id)) break;
    seen.add(child.id);
    fwd.push(child);
    cursor = child;
  }

  const ordered = [...back, ...fwd];
  const ids = ordered.map((n) => n.id);
  const reasonRows =
    ids.length > 0
      ? await db
          .select({ entityId: auditLog.entityId, changes: auditLog.changes })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.entityType, 'transactions'),
              eq(auditLog.action, 'insert'),
              inArray(auditLog.entityId, ids),
            ),
          )
      : [];
  const reasonById = new Map<string, string>();
  for (const r of reasonRows) {
    const changes = (r.changes ?? {}) as Record<string, unknown>;
    const reason = typeof changes.reason === 'string' ? changes.reason : null;
    if (reason && !reasonById.has(r.entityId)) reasonById.set(r.entityId, reason);
  }

  return ordered.map((n) => ({
    transactionId: n.id,
    label: label(n.external_ref),
    txnDate: n.txn_date,
    status: n.status,
    amountPaise: n.amount ?? '0',
    isCurrent: n.status !== 'reversed',
    reason: reasonById.get(n.id) ?? null,
  }));
}
