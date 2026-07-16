'use server';

import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import { auditLog } from '@/lib/db/schema/audit_log';
import { invoiceLines } from '@/lib/db/schema/invoice_lines';
import { invoices } from '@/lib/db/schema/invoices';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

import { createDraftInvoice, deleteDraftInvoice } from './invoices';
import { voidInvoice } from './invoice-transitions';

/**
 * Invoice "amend & reissue".
 *
 * An admin amends a SENT client invoice that was wrong. This is NOT in-place
 * editing of a posted invoice — posted-invoice immutability is preserved. The
 * flow instead:
 *
 *   (a) creates an editable DRAFT reissue (fresh invoice number) carrying every
 *       field + line of the original, linked back via `amendedFromInvoiceId`;
 *   (b) reverses the original's ledger posting and marks the original void
 *       (`voidInvoice`).
 *
 * The operator then edits the reissue in the composer and sends it — a fresh
 * ledger post. The reissue shows an "Amended" label and the amendment chain is
 * viewable.
 *
 * Ordering: the clone is created FIRST, then the original is voided. If the void
 * throws, the just-created reissue draft is best-effort deleted so a failed void
 * never leaves a dangling reissue. The GSTR-1 window is checked BEFORE any clone
 * so a closed-window invoice fails cleanly with no orphan draft.
 *
 * We derive the reissue's idempotency key from the original id ('amend:<id>'):
 * a double-click that races before the void lands returns the SAME pending
 * reissue instead of spawning a duplicate + double-reversing.
 */

const InvoiceIdSchema = z.string().uuid();

// NOT exported — a `'use server'` module may only export async server actions.
function parsePaise(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (typeof v === 'string' && v.trim() !== '') {
    try {
      return BigInt(v);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

export type AmendInvoiceResult = {
  invoiceId: string;
  documentNumber: string;
  /** true when a not-yet-sent reissue already existed (idempotent re-call). */
  alreadyPending: boolean;
};

export async function amendInvoice(invoiceId: string, reason: string): Promise<AmendInvoiceResult> {
  const ctx = await getActorContext();
  // Amending both creates a new invoice AND reverses the original's posting.
  requireCapability(ctx, 'create_invoice');
  requireCapability(ctx, 'void_invoice');

  if (reason.trim().length < 10) {
    throw new AppError('validation', 'Amendment reason must be at least 10 characters.');
  }

  const parsed = InvoiceIdSchema.parse(invoiceId);

  const [original] = await db.select().from(invoices).where(eq(invoices.id, parsed)).limit(1);
  if (!original) throw new AppError('not_found', `invoice ${parsed} not found`);

  // State guard — amend is only for a posted-but-unpaid tax invoice.
  switch (original.state) {
    case 'draft':
      throw new AppError(
        'validation',
        'This invoice is still a draft — edit it directly instead of amending.',
      );
    case 'paid':
      throw new AppError('validation', "Paid invoices can't be amended — issue a credit note.");
    case 'partially_paid':
      throw new AppError(
        'validation',
        'This invoice has a recorded payment. Reverse the receipt first, or issue a credit note.',
      );
    case 'void':
      throw new AppError('validation', 'This invoice was already voided/amended.');
    case 'sent':
      break; // only a sent invoice proceeds
  }

  // GSTR-1 window: an invoice can only be reversed in its own month or until the
  // 11th of the following month — after that its GST output has been filed and
  // the books must not change. Copied from voidInvoice; checked BEFORE any clone
  // so a closed-window invoice fails cleanly with no orphan reissue draft.
  {
    const docDate = new Date(`${String(original.documentDate).slice(0, 10)}T00:00:00Z`);
    const deadline = new Date(Date.UTC(docDate.getUTCFullYear(), docDate.getUTCMonth() + 1, 11));
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    if (today.getTime() > deadline.getTime()) {
      throw new AppError(
        'validation',
        `Invoice ${original.documentNumber} is past its GSTR-1 window (amendable until ${deadline
          .toISOString()
          .slice(0, 10)}). Issue a credit note instead.`,
      );
    }
  }

  // Idempotency: a not-yet-sent reissue from a previous (racing) click already
  // exists — return it WITHOUT re-voiding the original.
  const key = 'amend:' + invoiceId;
  const [existing] = await db
    .select({ id: invoices.id, documentNumber: invoices.documentNumber })
    .from(invoices)
    .where(eq(invoices.idempotencyKey, key))
    .limit(1);
  if (existing) {
    return {
      invoiceId: existing.id,
      documentNumber: existing.documentNumber,
      alreadyPending: true,
    };
  }

  // Clone the original's lines.
  const lines = await db
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, parsed))
    .orderBy(asc(invoiceLines.lineNo));
  if (lines.length === 0) {
    throw new AppError('validation', 'This invoice has no line items to reissue.');
  }

  const split = (original.capturedTaxSplit ?? {}) as Record<string, unknown>;

  // Step 1 — create the editable DRAFT reissue (fresh number). Carries every
  // field + line of the original, linked back via amendedFromInvoiceId and
  // keyed by the derived idempotency key.
  const newDraft = await createDraftInvoice({
    clientId: original.clientId,
    projectId: original.projectId,
    coveredUnderRetainer: original.coveredUnderRetainer,
    amendedFromInvoiceId: original.id,
    documentType: original.documentType,
    billToAddressId: original.billToAddressId,
    documentDate: original.documentDate,
    dueDate: original.dueDate,
    subtotalPaise: parsePaise(original.subtotalPaise),
    capturedTaxTotalPaise: parsePaise(original.capturedTaxTotalPaise),
    capturedTotalPaise: parsePaise(original.capturedTotalPaise),
    placeOfSupply: original.placeOfSupply,
    capturedTaxSplit: {
      cgst_paise: parsePaise(split.cgst_paise),
      sgst_paise: parsePaise(split.sgst_paise),
      igst_paise: parsePaise(split.igst_paise),
      cess_paise: parsePaise(split.cess_paise),
    },
    terms: original.terms,
    notes: original.notes,
    themeId: original.themeId,
    bankAccountId: original.bankAccountId,
    idempotencyKey: key,
    lines: lines.map((l) => ({
      lineNo: l.lineNo,
      serviceItemId: l.serviceItemId,
      projectId: l.projectId,
      description: l.description,
      sacCode: l.sacCode,
      qty: l.qty,
      ratePaise: parsePaise(l.ratePaise),
      capturedTaxableValuePaise: parsePaise(l.capturedTaxableValuePaise),
      capturedTaxRateBps: l.capturedTaxRateBps,
      capturedTaxAmountPaise: parsePaise(l.capturedTaxAmountPaise),
      postingAccountCode: l.postingAccountCode,
    })),
  });

  // Step 2 — reverse the original (void + ledger reversal). If it throws, the
  // reissue draft is now an orphan — best-effort delete it, then rethrow so a
  // failed void never leaves a dangling reissue.
  try {
    await voidInvoice(invoiceId, `Amended → ${newDraft.documentNumber}: ${reason.trim()}`);
  } catch (err) {
    await deleteDraftInvoice(newDraft.id).catch(() => {});
    throw err;
  }

  await logAudit({
    actorId: ctx.userId,
    entityType: 'invoices',
    entityId: newDraft.id,
    action: 'insert',
    changes: {
      amendedFrom: { id: invoiceId, documentNumber: original.documentNumber },
      reason: reason.trim(),
      newNumber: newDraft.documentNumber,
    },
  });

  return { invoiceId: newDraft.id, documentNumber: newDraft.documentNumber, alreadyPending: false };
}

/** One line of an invoice at a point in the amendment chain — for track-changes diffs. */
export type InvoiceAmendmentChainLine = {
  lineNo: number;
  description: string;
  qty: number;
  ratePaise: string;
  taxAmountPaise: string;
};

export type InvoiceAmendmentChainEntry = {
  id: string;
  documentNumber: string;
  state: string;
  documentDate: string;
  capturedTotalPaise: string;
  isCurrent: boolean;
  /** Amendment reason captured when THIS version was reissued (null for the original). */
  reason: string | null;
  placeOfSupply: string | null;
  lines: InvoiceAmendmentChainLine[];
};

/**
 * Walk the amendment chain for the given invoice in BOTH directions: follow
 * `amendedFromInvoiceId` backwards to the root, and forwards (rows whose
 * `amendedFromInvoiceId` = current id) to the tip. Returned oldest→newest.
 * `isCurrent` is true for any non-void row (the live tip of the chain). The
 * walk is capped to defend against a corrupt cycle.
 */
export async function getInvoiceAmendmentChain(
  invoiceId: string,
): Promise<ReadonlyArray<InvoiceAmendmentChainEntry>> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'create_invoice');
  const parsed = InvoiceIdSchema.parse(invoiceId);

  const CAP = 50;
  const cols = {
    id: invoices.id,
    documentNumber: invoices.documentNumber,
    state: invoices.state,
    documentDate: invoices.documentDate,
    capturedTotalPaise: invoices.capturedTotalPaise,
    placeOfSupply: invoices.placeOfSupply,
    amendedFromInvoiceId: invoices.amendedFromInvoiceId,
  };

  const [start] = await db.select(cols).from(invoices).where(eq(invoices.id, parsed)).limit(1);
  if (!start) return [];

  type Node = typeof start;
  const seen = new Set<string>([start.id]);

  // Backward: start → parent → … → root.
  const back: Node[] = [start];
  let cursor: Node = start;
  while (back.length < CAP && cursor.amendedFromInvoiceId) {
    const [parent] = await db
      .select(cols)
      .from(invoices)
      .where(eq(invoices.id, cursor.amendedFromInvoiceId))
      .limit(1);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    back.push(parent);
    cursor = parent;
  }
  back.reverse(); // now root → … → parent → start

  // Forward: start → child → … → tip.
  const fwd: Node[] = [];
  cursor = start;
  while (back.length + fwd.length < CAP) {
    const [child] = await db
      .select(cols)
      .from(invoices)
      .where(eq(invoices.amendedFromInvoiceId, cursor.id))
      .limit(1);
    if (!child || seen.has(child.id)) break;
    seen.add(child.id);
    fwd.push(child);
    cursor = child;
  }

  const ordered = [...back, ...fwd];
  const nodeIds = ordered.map((n) => n.id);

  // Per-version line items (for the field-level diff) — one batched query.
  const lineRows =
    nodeIds.length > 0
      ? await db
          .select({
            invoiceId: invoiceLines.invoiceId,
            lineNo: invoiceLines.lineNo,
            description: invoiceLines.description,
            qty: invoiceLines.qty,
            ratePaise: invoiceLines.ratePaise,
            capturedTaxAmountPaise: invoiceLines.capturedTaxAmountPaise,
          })
          .from(invoiceLines)
          .where(inArray(invoiceLines.invoiceId, nodeIds))
          .orderBy(asc(invoiceLines.lineNo))
      : [];
  const linesByInvoice = new Map<string, InvoiceAmendmentChainLine[]>();
  for (const l of lineRows) {
    const arr = linesByInvoice.get(l.invoiceId) ?? [];
    arr.push({
      lineNo: l.lineNo,
      description: l.description,
      qty: l.qty,
      ratePaise: String(l.ratePaise),
      taxAmountPaise: String(l.capturedTaxAmountPaise),
    });
    linesByInvoice.set(l.invoiceId, arr);
  }

  // The amendment reason for each reissued version lives in the audit trail:
  // amendInvoice writes entity_type='invoices' / action='insert' with a
  // `reason` in `changes`, keyed to the reissue's id. The root has none.
  const reasonRows =
    nodeIds.length > 0
      ? await db
          .select({ entityId: auditLog.entityId, changes: auditLog.changes })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.entityType, 'invoices'),
              eq(auditLog.action, 'insert'),
              inArray(auditLog.entityId, nodeIds),
            ),
          )
      : [];
  const reasonByInvoice = new Map<string, string>();
  for (const r of reasonRows) {
    const changes = (r.changes ?? {}) as Record<string, unknown>;
    const reason = typeof changes.reason === 'string' ? changes.reason : null;
    // Keep the first non-empty reason we see for a given reissue id.
    if (reason && !reasonByInvoice.has(r.entityId)) reasonByInvoice.set(r.entityId, reason);
  }

  return ordered.map((n) => ({
    id: n.id,
    documentNumber: n.documentNumber,
    state: n.state,
    documentDate: String(n.documentDate).slice(0, 10),
    capturedTotalPaise: String(n.capturedTotalPaise),
    isCurrent: n.state !== 'void',
    reason: reasonByInvoice.get(n.id) ?? null,
    placeOfSupply: n.placeOfSupply ?? null,
    lines: linesByInvoice.get(n.id) ?? [],
  }));
}
