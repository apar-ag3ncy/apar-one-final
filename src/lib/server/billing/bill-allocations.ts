'use server';

import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logActivity } from '@/lib/activity';
import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import { billAllocations, postings, transactions } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

/**
 * Vendor-side counterpart to `payment_allocations`. Allocates a
 * `vendor_payment_made` transaction to one or more `vendor_bill`
 * transactions so AP aging + per-bill outstanding can compute payable
 * balances properly.
 *
 *   - `allocateVendorPayment` — explicit allocation, caller-supplied
 *     list of `{ billTxnId, amountPaise }` pairs. The sum-check
 *     trigger from `drizzle/0031` blocks if the total exceeds the
 *     vendor_payment_made transaction's amount.
 *   - `fifoAllocateVendorPayment` — auto-allocates the payment FIFO
 *     against this vendor's open bills (oldest unpaid first). Used as
 *     a fallback by the vendor-payment form when the user doesn't
 *     pick allocations manually.
 *
 * Both functions write to `bill_allocations` only — no new ledger
 * postings; the underlying payment transaction is unchanged. AP aging
 * reads this table in Phase 6 (`getApAging`).
 */

const ALLOC_INPUT_SCHEMA = z.object({
  billTxnId: z.string().uuid(),
  amountPaise: z.bigint().positive(),
});

export type BillAllocationInput = z.infer<typeof ALLOC_INPUT_SCHEMA>;

export async function allocateVendorPayment(args: {
  vendorPaymentTxnId: string;
  allocations: readonly BillAllocationInput[];
}): Promise<{ allocationIds: readonly string[] }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'post_transaction');

  const paymentTxnId = z.string().uuid().parse(args.vendorPaymentTxnId);
  const parsed = z.array(ALLOC_INPUT_SCHEMA).min(1).parse(args.allocations);

  return db.transaction(async (tx) => {
    // Verify the payment transaction is a vendor_payment_made and that
    // it's actually posted (allocating against a draft payment is
    // ambiguous — the postings might still change). Also pull the
    // vendor so we can check every allocated bill belongs to the same
    // counterparty.
    const [payment] = await tx
      .select({
        id: transactions.id,
        kind: transactions.kind,
        status: transactions.status,
        paidToVendorId: transactions.paidToVendorId,
      })
      .from(transactions)
      .where(eq(transactions.id, paymentTxnId))
      .limit(1);
    if (!payment) throw new AppError('not_found', `transaction ${paymentTxnId} not found`);
    if (payment.kind !== 'vendor_payment_made') {
      throw new AppError(
        'validation',
        `transaction ${paymentTxnId} is ${payment.kind}, not vendor_payment_made`,
      );
    }
    if (payment.status !== 'posted') {
      throw new AppError(
        'validation',
        `transaction ${paymentTxnId} is ${payment.status}; only posted payments can be allocated`,
      );
    }

    // Verify every bill txn id is a vendor_bill, posted, and for the
    // same vendor. The aggregated check (sum vs payment total) lives
    // in the sum-check trigger.
    const billIds = parsed.map((a) => a.billTxnId);
    const bills = await tx
      .select({
        id: transactions.id,
        kind: transactions.kind,
        status: transactions.status,
        paidToVendorId: transactions.paidToVendorId,
      })
      .from(transactions)
      .where(sql`${transactions.id} = ANY(${billIds}::uuid[])`);
    const billById = new Map(bills.map((b) => [b.id, b]));
    for (const a of parsed) {
      const bill = billById.get(a.billTxnId);
      if (!bill) {
        throw new AppError('not_found', `bill txn ${a.billTxnId} not found`);
      }
      if (bill.kind !== 'vendor_bill') {
        throw new AppError('validation', `txn ${a.billTxnId} is ${bill.kind}, not vendor_bill`);
      }
      if (bill.status !== 'posted') {
        throw new AppError(
          'validation',
          `bill ${a.billTxnId} is ${bill.status}; only posted bills can be allocated against`,
        );
      }
      if (bill.paidToVendorId !== payment.paidToVendorId) {
        throw new AppError(
          'validation',
          `bill ${a.billTxnId} vendor ${bill.paidToVendorId} != payment vendor ${payment.paidToVendorId}`,
        );
      }
    }

    const inserted = await tx
      .insert(billAllocations)
      .values(
        parsed.map((a) => ({
          vendorPaymentTxnId: paymentTxnId,
          billTxnId: a.billTxnId,
          amountPaise: a.amountPaise,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })),
      )
      .returning({ id: billAllocations.id });

    await logAudit({
      actorId: ctx.userId,
      entityType: 'transaction',
      entityId: paymentTxnId,
      action: 'update',
      changes: {
        bill_allocations: {
          before: null,
          after: parsed.map((a) => ({
            bill_txn_id: a.billTxnId,
            amount_paise: a.amountPaise.toString(),
          })),
        },
      },
    });
    if (payment.paidToVendorId) {
      await logActivity({
        entityType: 'vendor',
        entityId: payment.paidToVendorId,
        actorId: ctx.userId,
        kind: 'transaction.posted',
        summary: `Vendor payment allocated across ${parsed.length} bill(s)`,
        payload: {
          vendor_payment_txn_id: paymentTxnId,
          allocation_count: parsed.length,
        },
      });
    }

    return { allocationIds: inserted.map((r) => r.id) };
  });
}

/**
 * FIFO auto-allocator. Walks this vendor's posted bills oldest-first
 * and allocates the payment against each until the payment is
 * exhausted. Skips bills already fully allocated by prior payments.
 *
 * Returns the allocation rows + the remaining un-allocated amount on
 * the payment (zero if the bills covered everything).
 */
export async function fifoAllocateVendorPayment(args: {
  vendorPaymentTxnId: string;
}): Promise<{ allocationIds: readonly string[]; unallocatedPaise: bigint }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'post_transaction');

  const paymentTxnId = z.string().uuid().parse(args.vendorPaymentTxnId);

  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select({
        id: transactions.id,
        kind: transactions.kind,
        status: transactions.status,
        paidToVendorId: transactions.paidToVendorId,
      })
      .from(transactions)
      .where(eq(transactions.id, paymentTxnId))
      .limit(1);
    if (!payment) throw new AppError('not_found', `transaction ${paymentTxnId} not found`);
    if (payment.kind !== 'vendor_payment_made' || payment.status !== 'posted') {
      throw new AppError(
        'validation',
        `transaction ${paymentTxnId} is not a posted vendor_payment_made`,
      );
    }
    if (!payment.paidToVendorId) {
      throw new AppError('validation', `payment ${paymentTxnId} has no vendor`);
    }

    // Payment total = sum of debits on the vendor_payment_made txn.
    const totalRow = await tx.execute<{ total: string }>(sql`
      SELECT COALESCE(SUM(amount_paise), 0)::text AS total
      FROM postings
      WHERE transaction_id = ${paymentTxnId} AND side = 'debit'
    `);
    const totalStr = Array.isArray(totalRow) ? (totalRow[0]?.total ?? '0') : '0';
    let remaining = BigInt(totalStr);
    if (remaining <= 0n) {
      return { allocationIds: [], unallocatedPaise: 0n };
    }

    // Subtract anything already allocated on this payment.
    const allocatedRow = await tx.execute<{ total: string }>(sql`
      SELECT COALESCE(SUM(amount_paise), 0)::text AS total
      FROM bill_allocations
      WHERE vendor_payment_txn_id = ${paymentTxnId}
    `);
    const allocatedStr = Array.isArray(allocatedRow) ? (allocatedRow[0]?.total ?? '0') : '0';
    remaining -= BigInt(allocatedStr);
    if (remaining <= 0n) {
      return { allocationIds: [], unallocatedPaise: 0n };
    }

    // Find vendor's posted bills oldest-first with their outstanding.
    // Outstanding = bill total (debit sum) − sum of bill_allocations.
    const bills = await tx.execute<{ bill_id: string; outstanding: string }>(sql`
      SELECT
        t.id AS bill_id,
        (
          COALESCE((
            SELECT SUM(p.amount_paise) FROM postings p
            WHERE p.transaction_id = t.id AND p.side = 'credit'
          ), 0)
          - COALESCE((
            SELECT SUM(amount_paise) FROM bill_allocations
            WHERE bill_txn_id = t.id
          ), 0)
        )::text AS outstanding
      FROM transactions t
      WHERE t.kind = 'vendor_bill'
        AND t.status = 'posted'
        AND t.paid_to_vendor_id = ${payment.paidToVendorId}
      ORDER BY t.txn_date ASC, t.created_at ASC
    `);

    const allocs: {
      vendorPaymentTxnId: string;
      billTxnId: string;
      amountPaise: bigint;
      createdBy: string;
      updatedBy: string;
    }[] = [];
    for (const r of Array.isArray(bills) ? bills : []) {
      if (remaining <= 0n) break;
      const outstanding = BigInt(r.outstanding ?? '0');
      if (outstanding <= 0n) continue;
      const take = outstanding < remaining ? outstanding : remaining;
      allocs.push({
        vendorPaymentTxnId: paymentTxnId,
        billTxnId: r.bill_id,
        amountPaise: take,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      });
      remaining -= take;
    }

    if (allocs.length === 0) {
      return { allocationIds: [], unallocatedPaise: remaining };
    }

    const inserted = await tx
      .insert(billAllocations)
      .values(allocs)
      .returning({ id: billAllocations.id });

    await logActivity({
      entityType: 'vendor',
      entityId: payment.paidToVendorId,
      actorId: ctx.userId,
      kind: 'transaction.posted',
      summary: `Vendor payment FIFO-allocated across ${allocs.length} bill(s)`,
      payload: {
        vendor_payment_txn_id: paymentTxnId,
        allocation_count: allocs.length,
        unallocated_paise: remaining.toString(),
      },
    });

    return { allocationIds: inserted.map((r) => r.id), unallocatedPaise: remaining };
  });
}

void asc;
void and;
