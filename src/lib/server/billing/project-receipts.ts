'use server';

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { getActorContext } from '@/lib/server/actor';

/**
 * "Amount received till now" per project (item 9).
 *
 * Money flows: receipt → `client_payment_received` txn → `receipt_allocations`
 * → `client_invoice` txn → invoice → lines → project. Apportionment rule:
 *
 *   - A line's effective project = COALESCE(line.project_id, invoice.project_id).
 *   - A line's weight = captured_taxable_value_paise + captured_tax_amount_paise.
 *   - Each allocation is split pro-rata across the invoice's effective
 *     projects by weight share, FLOOR-dividing in integer paise
 *     (floor(allocated × weight ÷ total_weight)). Sub-paisa dust is DROPPED —
 *     never invented — so Σ(per-project) ≤ allocated.
 *   - An invoice with zero total line weight falls back to its header
 *     project receiving the full allocation.
 *
 * The intermediate product allocated×weight can exceed bigint, so the SQL
 * widens through numeric and casts the floored result back to bigint. This is
 * a DISPLAY-time derivation (CLAUDE captured-not-computed applies to data at
 * rest; nothing here is stored).
 *
 * Parent projects are NOT auto-aggregated here — callers pass the family
 * ([parent, ...childIds]) and sum, keeping the query simple and reusable.
 */

const ProjectIdsSchema = z.array(z.string().uuid()).min(1).max(200);

export type ProjectReceivedRow = {
  projectId: string;
  receivedPaise: bigint;
};

export async function getAmountsReceivedByProject(
  projectIds: readonly string[],
): Promise<readonly ProjectReceivedRow[]> {
  await getActorContext();
  const ids = ProjectIdsSchema.parse([...projectIds]);

  const idList = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  const rows = await db.execute<{ project_id: string; received: string }>(sql`
    with inv_alloc as (
      -- Total allocated (received) against each invoice.
      select i.id as invoice_id,
             i.project_id as header_project_id,
             sum(ra.amount_paise) as allocated
      from receipt_allocations ra
      join invoices i on i.posted_transaction_id = ra.client_invoice_txn_id
      where ra.deleted_at is null and i.deleted_at is null
      group by i.id, i.project_id
    ),
    line_weights as (
      -- Weight per (invoice, effective project).
      select il.invoice_id,
             coalesce(il.project_id, i.project_id) as eff_project,
             sum(il.captured_taxable_value_paise + il.captured_tax_amount_paise) as weight
      from invoice_lines il
      join invoices i on i.id = il.invoice_id
      where il.deleted_at is null and i.deleted_at is null
      group by il.invoice_id, coalesce(il.project_id, i.project_id)
    ),
    inv_weight_totals as (
      select invoice_id, sum(weight) as total_weight
      from line_weights
      group by invoice_id
    ),
    apportioned as (
      -- Pro-rata share, floored in integer paise (dust dropped).
      select lw.eff_project as project_id,
             floor(ia.allocated::numeric * lw.weight / iwt.total_weight)::bigint as share
      from inv_alloc ia
      join inv_weight_totals iwt
        on iwt.invoice_id = ia.invoice_id and iwt.total_weight > 0
      join line_weights lw on lw.invoice_id = ia.invoice_id
      where lw.eff_project is not null

      union all

      -- Zero-weight (or line-less) invoices: header project gets it all.
      select ia.header_project_id as project_id, ia.allocated as share
      from inv_alloc ia
      left join inv_weight_totals iwt on iwt.invoice_id = ia.invoice_id
      where ia.header_project_id is not null
        and coalesce(iwt.total_weight, 0) = 0
    )
    select project_id, sum(share)::text as received
    from apportioned
    where project_id in (${idList})
    group by project_id
  `);

  const byId = new Map<string, bigint>();
  for (const r of rows) byId.set(r.project_id, BigInt(r.received ?? '0'));
  return ids.map((projectId) => ({
    projectId,
    receivedPaise: byId.get(projectId) ?? 0n,
  }));
}
