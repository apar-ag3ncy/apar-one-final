'use server';

import { eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { transactions } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { getActorContext } from '@/lib/server/actor';
import { postTransaction, reverseTransaction } from '@/lib/server/ledger/transactions';
import type { ValidationFlag } from '@/lib/server/ledger/types';

/**
 * Thin server-action wrappers around the orchestrator in
 * `lib/server/ledger/transactions`. They exist so client components
 * can RPC-call them via Next's 'use server' boundary — the orchestrator
 * itself requires a CurrentUserContext, which the wrapper resolves via
 * `getActorContext()`.
 *
 *   - getDraftTransactionFlags(id) — fetches stored validation_flags so
 *     the Post confirm dialog can render them with acknowledge checkboxes.
 *   - postTransactionAction(input)  — posts a draft, with the user's
 *     acknowledgments of any warn/block flags.
 *   - reverseTransactionAction(input) — creates a reversing entry
 *     against a posted transaction.
 */

export type DraftFlagsResult = {
  status: string;
  flags: readonly ValidationFlag[];
};

export async function getDraftTransactionFlags(transactionId: string): Promise<DraftFlagsResult> {
  await getActorContext();
  const rows = await db
    .select({
      status: transactions.status,
      validationFlags: transactions.validationFlags,
    })
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AppError('not_found', `Transaction ${transactionId} not found`);
  const flags = (row.validationFlags ?? []) as ValidationFlag[];
  return {
    status: row.status,
    flags,
  };
}

export async function postTransactionAction(args: {
  transactionId: string;
  acknowledgedFlags?: string[];
}): Promise<void> {
  const ctx = await getActorContext();
  try {
    await postTransaction(ctx, args);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('internal', describeDbError(e));
  }
}

/**
 * Pulls the real PG / trigger reason out of a Drizzle-wrapped error.
 *
 * Drizzle throws errors whose `.message` is "Failed query: <SQL>
 * params: <values>" — the actual cause (FK violation, trigger raise,
 * etc.) hangs off `.cause`. Walk the cause chain so the user-facing
 * toast shows "polymorphic FK violation: …" or "transaction <id>
 * unbalanced: Dr=… Cr=…" instead of just the query text.
 */
function describeDbError(e: unknown): string {
  if (!(e instanceof Error)) return 'Failed to post transaction';
  // Walk up to 5 levels deep — postgres-js sometimes nests its own
  // PostgresError under Drizzle's wrapper.
  let current: Error | undefined = e;
  let depth = 0;
  while (current && depth < 5) {
    const cause: unknown = (current as Error & { cause?: unknown }).cause;
    if (cause instanceof Error) {
      current = cause;
      depth += 1;
    } else {
      break;
    }
  }
  return current?.message ?? e.message ?? 'Failed to post transaction';
}

export async function reverseTransactionAction(args: {
  transactionId: string;
  reason: string;
}): Promise<{ reversalTransactionId: string }> {
  const ctx = await getActorContext();
  return reverseTransaction(ctx, args);
}
