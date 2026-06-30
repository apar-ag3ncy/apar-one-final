'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { vendors } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { createDraftTransaction, postTransaction } from '@/lib/server/ledger/transactions';

/**
 * Vendor-side adjustments — the mirror of the client advance + credit-note
 * flows, posted as `journal` transactions (same mechanism as issueCreditNote).
 *
 *   - recordVendorAdvance  → Dr 1220 Advances to Vendors / Cr 1120 Bank
 *   - issueVendorDebitNote → Dr 2110 Trade Payables / Cr 5100 Vendor Costs
 *                            (+ Cr 1250 GST Input Credit reversal)
 *
 * Both go through the ledger so the books + the vendor's 2110/1220 sub-ledgers
 * stay correct. A vendor payment with source='advance' later draws an advance
 * down (Dr 2110 / Cr 1220).
 */

export type VendorAdjustmentResult =
  | { ok: true; transactionId: string }
  | { ok: false; message: string };

function toErr(e: unknown): { ok: false; message: string } {
  if (e instanceof AppError) return { ok: false, message: e.message };
  console.error('[billing/vendor-adjustments] action error:', e);
  return { ok: false, message: 'Something went wrong. Please try again.' };
}

async function vendorName(vendorId: string): Promise<string | null> {
  const [v] = await db
    .select({ name: vendors.name })
    .from(vendors)
    .where(and(eq(vendors.id, vendorId), isNull(vendors.deletedAt)))
    .limit(1);
  return v?.name ?? null;
}

/* -------------------------------------------------------------------------- */
/* Vendor advance                                                              */
/* -------------------------------------------------------------------------- */

const VendorAdvanceInput = z.object({
  vendorId: z.string().uuid(),
  bankAccountId: z.string().uuid(),
  amountPaise: z.bigint().positive(),
  txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(2000).nullish(),
});
export type VendorAdvanceInputShape = z.input<typeof VendorAdvanceInput>;

/**
 * Record an advance paid to a vendor (before any bill): Dr 1220 Advances to
 * Vendors (vendor) / Cr 1120 Bank (account). The balance sits as a prepaid
 * asset on the vendor's 1220 sub-ledger; a later vendor payment with
 * source='advance' draws it down.
 */
export async function recordVendorAdvance(
  input: VendorAdvanceInputShape,
): Promise<VendorAdjustmentResult> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'create_journal_voucher');
    const v = VendorAdvanceInput.parse(input);
    const name = await vendorName(v.vendorId);
    if (!name) return { ok: false, message: 'Vendor not found.' };

    const draft = await createDraftTransaction(ctx, {
      kind: 'journal',
      input: {
        externalRef: `vendor_advance:${v.vendorId}:${Date.now()}`,
        txnDate: v.txnDate,
        journalReason: `Advance paid to vendor ${name}`,
        legs: [
          {
            accountCode: '1220',
            side: 'debit',
            amountPaise: v.amountPaise,
            subledger: { entityType: 'vendor', entityId: v.vendorId },
          },
          {
            accountCode: '1120',
            side: 'credit',
            amountPaise: v.amountPaise,
            subledger: { entityType: 'office', entityId: v.bankAccountId },
          },
        ],
        isOpeningBalance: false,
        notes: v.notes ?? null,
      },
    });
    await postTransaction(ctx, { transactionId: draft.transactionId, acknowledgedFlags: [] });
    revalidatePath(`/vendors/${v.vendorId}`);
    return { ok: true, transactionId: draft.transactionId };
  } catch (e) {
    return toErr(e);
  }
}

/* -------------------------------------------------------------------------- */
/* Vendor debit note                                                           */
/* -------------------------------------------------------------------------- */

const VendorDebitNoteInput = z.object({
  vendorId: z.string().uuid(),
  /** Net amount of the cost being reversed (excl. GST). */
  subtotalPaise: z.bigint().nonnegative(),
  /** Input GST being reversed (0 when there was none / no GST impact). */
  gstPaise: z.bigint().nonnegative().default(0n),
  reason: z.string().trim().min(3, 'Give a reason.').max(500),
  txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(2000).nullish(),
});
export type VendorDebitNoteInputShape = z.input<typeof VendorDebitNoteInput>;

/**
 * Issue a debit note to a vendor — reduces what we owe (purchase return,
 * over-billing, rate correction). Mirror of a client credit note. Posts
 * Dr 2110 Trade Payables (vendor) [total] / Cr 5100 Vendor Costs (vendor)
 * [subtotal] + Cr 1250 GST Input Credit [gst], reversing the bill's cost +
 * input GST.
 */
export async function issueVendorDebitNote(
  input: VendorDebitNoteInputShape,
): Promise<VendorAdjustmentResult> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'create_journal_voucher');
    const v = VendorDebitNoteInput.parse(input);
    const total = v.subtotalPaise + v.gstPaise;
    if (total <= 0n) return { ok: false, message: 'Enter a positive amount.' };
    const name = await vendorName(v.vendorId);
    if (!name) return { ok: false, message: 'Vendor not found.' };

    const legs = [
      {
        accountCode: '2110',
        side: 'debit' as const,
        amountPaise: total,
        subledger: { entityType: 'vendor' as const, entityId: v.vendorId },
      },
      {
        accountCode: '5100',
        side: 'credit' as const,
        amountPaise: v.subtotalPaise,
        subledger: { entityType: 'vendor' as const, entityId: v.vendorId },
      },
      ...(v.gstPaise > 0n
        ? [{ accountCode: '1250', side: 'credit' as const, amountPaise: v.gstPaise }]
        : []),
    ];

    const draft = await createDraftTransaction(ctx, {
      kind: 'journal',
      input: {
        externalRef: `vendor_debit_note:${v.vendorId}:${Date.now()}`,
        txnDate: v.txnDate,
        journalReason: `Debit note to vendor ${name}: ${v.reason}`,
        legs,
        isOpeningBalance: false,
        notes: v.notes ?? null,
      },
    });
    await postTransaction(ctx, { transactionId: draft.transactionId, acknowledgedFlags: [] });
    revalidatePath(`/vendors/${v.vendorId}`);
    return { ok: true, transactionId: draft.transactionId };
  } catch (e) {
    return toErr(e);
  }
}
