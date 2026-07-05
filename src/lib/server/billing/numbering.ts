import 'server-only';

import { desc, eq } from 'drizzle-orm';

import { formatDocumentNumber, parseSequence } from '@/lib/billing/fy';
import { db, type DbClient } from '@/lib/db/client';
import {
  billingSettings,
  creditNotes,
  estimates,
  invoices,
  receiptVouchers,
  receipts,
  refundVouchers,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';

/**
 * Document numbering. CBIC requires distinct sequences per document
 * type, per financial year (Rule 46). The unique index per (FY, number)
 * on each table backstops duplicates at the DB layer; this helper
 * computes the next free number under the configured prefix + mask.
 *
 * Concurrency model: low volume (a few invoices per day max). Two
 * concurrent createDraftInvoice calls might pick the same next-seq and
 * one would fail the unique-index check at INSERT time. Callers handle
 * the unique-violation by retrying — see `withNumberingRetry` below.
 */

export type DocKind =
  | 'invoice'
  | 'estimate'
  | 'credit_note'
  | 'receipt'
  | 'receipt_voucher'
  | 'refund_voucher';

/** Server-only helper — pre-loads billing_settings once, since most
 *  callers need several fields at once. */
export async function loadBillingSettings(
  client: DbClient = db,
): Promise<typeof billingSettings.$inferSelect> {
  const [row] = await client
    .select()
    .from(billingSettings)
    .where(eq(billingSettings.singleton, true))
    .limit(1);
  if (row) return row;

  // Self-heal: the 0019 migration seeds the singleton, but there is no UI to
  // recreate it if it's ever lost (e.g. a manual data wipe). Every column has
  // a schema default, so recreate it in place rather than dead-ending all
  // document numbering. onConflictDoNothing covers a concurrent healer.
  await client.insert(billingSettings).values({ singleton: true }).onConflictDoNothing();
  const [healed] = await client
    .select()
    .from(billingSettings)
    .where(eq(billingSettings.singleton, true))
    .limit(1);
  if (!healed) {
    throw new AppError(
      'internal',
      'billing_settings singleton row missing and could not be recreated.',
    );
  }
  return healed;
}

function prefixFor(kind: DocKind, s: typeof billingSettings.$inferSelect): string {
  switch (kind) {
    case 'invoice':
      return s.invoiceNumberPrefix;
    case 'estimate':
      return s.estimateNumberPrefix;
    case 'credit_note':
      return s.creditNoteNumberPrefix;
    case 'receipt':
      return s.receiptNumberPrefix;
    case 'receipt_voucher':
      return s.receiptVoucherNumberPrefix;
    case 'refund_voucher':
      return s.refundVoucherNumberPrefix;
  }
}

/**
 * Look up the highest existing document_number under `fyStart` for the
 * given doc kind and return the next-sequence-ready string. Reads only;
 * the caller is responsible for re-running this within a retry loop if
 * the INSERT fails the unique constraint.
 */
export async function nextDocumentNumber(
  kind: DocKind,
  fyStart: string,
  client: DbClient = db,
): Promise<{
  documentNumber: string;
  sequence: number;
  prefix: string;
  mask: string;
  fyLabel: string;
}> {
  const settings = await loadBillingSettings(client);
  const prefix = prefixFor(kind, settings);
  const mask = settings.invoiceNumberFormat; // same mask across doc kinds in v1

  // FY label: 2025-04-01 → 2025-26
  const yy = Number(fyStart.slice(0, 4));
  const fyLabel = `${yy}-${String((yy + 1) % 100).padStart(2, '0')}`;

  // Latest document under this FY, scan descending — small per-FY rowcount.
  const max = await readLatestSequence(kind, fyStart, mask, client);
  const next = max + 1;
  return {
    documentNumber: formatDocumentNumber(prefix, fyLabel, next, mask),
    sequence: next,
    prefix,
    mask,
    fyLabel,
  };
}

async function readLatestSequence(
  kind: DocKind,
  fyStart: string,
  mask: string,
  client: DbClient,
): Promise<number> {
  let docs: Array<{ documentNumber: string }> = [];
  switch (kind) {
    case 'invoice':
      // ALL rows for the FY (not just the lexicographic top): invoices may now
      // carry user-supplied document numbers that don't conform to the mask, so
      // the next sequence must be the numeric MAX over conforming rows, computed
      // below — never the lexicographically-highest string.
      docs = await client
        .select({ documentNumber: invoices.documentNumber })
        .from(invoices)
        .where(eq(invoices.financialYearStart, fyStart));
      break;
    case 'estimate':
      docs = await client
        .select({ documentNumber: estimates.documentNumber })
        .from(estimates)
        .where(eq(estimates.financialYearStart, fyStart))
        .orderBy(desc(estimates.documentNumber))
        .limit(1);
      break;
    case 'credit_note':
      docs = await client
        .select({ documentNumber: creditNotes.documentNumber })
        .from(creditNotes)
        .where(eq(creditNotes.financialYearStart, fyStart))
        .orderBy(desc(creditNotes.documentNumber))
        .limit(1);
      break;
    case 'receipt':
      docs = await client
        .select({ documentNumber: receipts.receiptNumber })
        .from(receipts)
        .where(eq(receipts.financialYearStart, fyStart))
        .orderBy(desc(receipts.receiptNumber))
        .limit(1);
      break;
    case 'receipt_voucher':
      docs = await client
        .select({ documentNumber: receiptVouchers.voucherNumber })
        .from(receiptVouchers)
        .where(eq(receiptVouchers.financialYearStart, fyStart))
        .orderBy(desc(receiptVouchers.voucherNumber))
        .limit(1);
      break;
    case 'refund_voucher':
      docs = await client
        .select({ documentNumber: refundVouchers.voucherNumber })
        .from(refundVouchers)
        .where(eq(refundVouchers.financialYearStart, fyStart))
        .orderBy(desc(refundVouchers.voucherNumber))
        .limit(1);
      break;
  }
  // Numeric max over rows that parse under the configured mask. A user-supplied
  // invoice number that doesn't conform (or sorts lexicographically above the
  // series) is ignored here rather than resetting the sequence to 0 — which
  // would collide with the existing low numbers on the next auto-allocation and
  // brick auto-numbering for the whole FY. Non-invoice kinds return a single row
  // (their lexicographic top == numeric max, since they're auto-only).
  let max = 0;
  for (const d of docs) {
    const seq = parseSequence(d.documentNumber, mask);
    if (Number.isFinite(seq) && seq > max) max = seq;
  }
  return max;
}

/**
 * Wrapper for callers that INSERT a new billing doc. Retries up to N
 * times on unique-violation against the FY+number unique constraint:
 * recomputes the next sequence and re-attempts.
 */
export async function withNumberingRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/duplicate key value/i.test(msg) && /document_number_per_fy_unique/i.test(msg)) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw new AppError(
    'conflict',
    'Could not allocate a new document number after retries; concurrent INSERT contention.',
    { cause: lastErr },
  );
}

// Re-export the avoid-circular dependency placeholder so other modules
// can opt-in to the same retry shape without duplicating it.
// (No-op export — purely for grep-ability.)
export const __numbering = true;
