'use server';

import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

import { fyStartForDate, todayIstIso } from '@/lib/billing/fy';
import { db, type DbClient } from '@/lib/db/client';
import { clients, entityAddresses, invoiceLines, invoices, projects } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { isValidStateCode, stateCodeToGstCode, stateNameFromCode } from '@/lib/india/gst-states';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import type { ValidationFlag } from '@/lib/server/ledger/types';

import { loadBillingSettings, nextDocumentNumber, withNumberingRetry } from './numbering';
import { runInvoiceValidations, type InvoiceDraftSnapshot } from './validation';

/**
 * Invoice draft + read actions.
 *
 *   createDraftInvoice(input) — capability create_invoice; party + ≥1
 *     line required; allocates next document_number under the FY;
 *     runs billing validations and persists validation_flags.
 *
 *   updateDraftInvoice(id, input) — same shape, draft-state only.
 *     Refuses with 'ledger.posted_immutable' if state != 'draft'.
 *
 *   getInvoice(id) — invoice + lines.
 *   listInvoices(filters) — filterable list.
 *
 * Send / void / mark-viewed live in a follow-up commit. Posting to the
 * ledger happens at send-time, not on create — the draft is purely a
 * billing-side document until the user commits to issuing it.
 */

const StateCodeRe = /^[0-9]{2}$/;

const InvoiceLineInputSchema = z.object({
  lineNo: z.number().int().positive(),
  serviceItemId: z.string().uuid().nullish(),
  description: z.string().trim().min(1).max(1000),
  sacCode: z
    .string()
    .trim()
    .max(8)
    .nullish()
    .refine((v) => !v || /^[0-9]{4,8}$/.test(v), { message: 'SAC must be 4 to 8 digits.' }),
  qty: z.number().int().positive().default(1),
  ratePaise: z.bigint().nonnegative().default(0n),
  capturedTaxableValuePaise: z.bigint().nonnegative().default(0n),
  capturedTaxRateBps: z.number().int().min(0).max(10000).default(0),
  capturedTaxAmountPaise: z.bigint().nonnegative().default(0n),
  postingAccountCode: z.string().trim().max(20).default('4100'),
});

export type InvoiceLineInput = z.input<typeof InvoiceLineInputSchema>;

const TaxSplitSchema = z
  .object({
    cgst_paise: z.bigint().nonnegative().optional(),
    sgst_paise: z.bigint().nonnegative().optional(),
    igst_paise: z.bigint().nonnegative().optional(),
    cess_paise: z.bigint().nonnegative().optional(),
  })
  .strict();

const CreateInvoiceInputSchema = z.object({
  clientId: z.string().uuid(),
  projectId: z.string().uuid().nullish(),
  /** Document type. 'proforma' is a labelled proforma; it otherwise behaves
   *  like a tax 'invoice' (same numbering + ledger posting on send). */
  documentType: z.enum(['invoice', 'proforma']).default('invoice'),
  /** Optional user-supplied document number. Omitted → the next number in the
   *  FY series is auto-allocated. Supplied → used verbatim; a duplicate within
   *  the FY is rejected (never silently re-numbered). */
  documentNumber: z.string().trim().min(1).max(60).nullish(),
  /** Chosen bill-to address (one of the client's entity_addresses). Null → the
   *  PDF falls back to the registered/primary address. */
  billToAddressId: z.string().uuid().nullish(),
  documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'documentDate must be YYYY-MM-DD'),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be YYYY-MM-DD')
    .nullish(),
  subtotalPaise: z.bigint().nonnegative().default(0n),
  capturedTaxTotalPaise: z.bigint().nonnegative().default(0n),
  capturedTotalPaise: z.bigint().nonnegative().default(0n),
  placeOfSupply: z
    .string()
    .trim()
    .nullish()
    .refine((v) => !v || StateCodeRe.test(v), {
      message: 'placeOfSupply must be a 2-digit state code.',
    }),
  capturedTaxSplit: TaxSplitSchema.optional(),
  terms: z.string().trim().max(4000).nullish(),
  notes: z.string().trim().max(4000).nullish(),
  /** Selected invoice theme (visual skin for the generated PDF). */
  themeId: z.string().uuid().nullish(),
  /** Which company bank account prints in the payment block. Null → the
   *  renderer falls back to the primary account. */
  bankAccountId: z.string().uuid().nullish(),
  /** Caller-supplied idempotency key. Same key returns the same invoice id. */
  idempotencyKey: z.string().trim().min(8).max(200),
  lines: z.array(InvoiceLineInputSchema).min(1, 'Invoice must have at least one line.'),
});

export type CreateInvoiceInput = z.input<typeof CreateInvoiceInputSchema>;

export type CreateInvoiceResult = {
  id: string;
  documentNumber: string;
  validationFlags: ValidationFlag[];
};

/**
 * A client's billing readiness. GSTIN, PAN and a registered address are
 * OPTIONAL when the client is first created, but REQUIRED to generate an
 * invoice for them (India B2B GST invoices). `stateCode` is derived from the
 * GSTIN (preferred) or the registered address — it pre-fills place of supply.
 */
export type ClientBillingReadiness = {
  clientId: string;
  gstin: string | null;
  pan: string | null;
  hasAddress: boolean;
  stateCode: string | null;
  stateName: string | null;
  missing: string[];
  ready: boolean;
};

async function loadClientBillingReadiness(
  clientId: string,
  client: DbClient = db,
): Promise<ClientBillingReadiness> {
  const [c] = await client
    .select({ id: clients.id, gstin: clients.gstin, pan: clients.pan })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!c) throw new AppError('not_found', `client ${clientId} not found`);

  const addrs = await client
    .select({ stateCode: entityAddresses.stateCode })
    .from(entityAddresses)
    .where(
      and(
        eq(entityAddresses.entityType, 'client'),
        eq(entityAddresses.entityId, clientId),
        isNull(entityAddresses.deletedAt),
      ),
    )
    .orderBy(asc(entityAddresses.kind))
    .limit(1);
  const hasAddress = addrs.length > 0;

  const gstinState = c.gstin && c.gstin.length >= 2 ? c.gstin.slice(0, 2) : null;
  const addrState = addrs[0]?.stateCode ?? null;
  const stateCode =
    (gstinState && isValidStateCode(gstinState) && stateCodeToGstCode(gstinState)) ||
    (addrState && isValidStateCode(addrState) && stateCodeToGstCode(addrState)) ||
    null;

  const missing: string[] = [];
  if (!c.gstin) missing.push('GSTIN');
  if (!c.pan) missing.push('PAN');
  if (!hasAddress) missing.push('address');

  return {
    clientId,
    gstin: c.gstin,
    pan: c.pan,
    hasAddress,
    stateCode,
    stateName: stateNameFromCode(stateCode),
    missing,
    ready: missing.length === 0,
  };
}

/** Reject a project that doesn't belong to this client (cross-client attach). */
async function assertProjectBelongsToClient(
  projectId: string | null | undefined,
  clientId: string,
  client: DbClient = db,
): Promise<void> {
  if (!projectId) return;
  const [p] = await client
    .select({ clientId: projects.clientId })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (!p) throw new AppError('validation', 'The selected project no longer exists.');
  if (p.clientId !== clientId) {
    throw new AppError('validation', 'The selected project belongs to a different client.');
  }
}

/** Reject a bill-to address that isn't a live address of this client. */
async function assertBillToAddressBelongsToClient(
  addressId: string | null | undefined,
  clientId: string,
  client: DbClient = db,
): Promise<void> {
  if (!addressId) return;
  const [a] = await client
    .select({ id: entityAddresses.id })
    .from(entityAddresses)
    .where(
      and(
        eq(entityAddresses.id, addressId),
        eq(entityAddresses.entityType, 'client'),
        eq(entityAddresses.entityId, clientId),
        isNull(entityAddresses.deletedAt),
      ),
    )
    .limit(1);
  if (!a) {
    throw new AppError('validation', 'The selected bill-to address is not valid for this client.');
  }
}

/** Read a client's invoice-readiness — used by the composer/section to gate
 *  "New invoice" and to pre-fill place of supply. */
export async function getClientBillingReadiness(clientId: string): Promise<ClientBillingReadiness> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'create_invoice');
  return loadClientBillingReadiness(z.string().uuid().parse(clientId));
}

export async function createDraftInvoice(input: CreateInvoiceInput): Promise<CreateInvoiceResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'create_invoice');

  const v = CreateInvoiceInputSchema.parse(input);

  // India B2B GST: a client must have GSTIN + PAN + address before any invoice
  // can be generated for them (these are optional only at client signup).
  const readiness = await loadClientBillingReadiness(v.clientId);
  if (!readiness.ready) {
    throw new AppError(
      'validation',
      `This client is missing ${readiness.missing.join(', ')}. Add the client's GSTIN, PAN and address before generating an invoice.`,
    );
  }

  // A linked project / bill-to address must belong to THIS client.
  await assertProjectBelongsToClient(v.projectId, v.clientId);
  await assertBillToAddressBelongsToClient(v.billToAddressId, v.clientId);

  // Short-circuit on idempotency key — if we've already created an
  // invoice with this key, return the same id.
  const existing = await db
    .select({
      id: invoices.id,
      documentNumber: invoices.documentNumber,
      validationFlags: invoices.validationFlags,
    })
    .from(invoices)
    .where(eq(invoices.idempotencyKey, v.idempotencyKey))
    .limit(1);
  if (existing[0]) {
    return {
      id: existing[0].id,
      documentNumber: existing[0].documentNumber,
      validationFlags: (existing[0].validationFlags as ValidationFlag[]) ?? [],
    };
  }

  const settings = await loadBillingSettings();
  const fyStart = fyStartForDate(v.documentDate, settings.fyStartMonth);

  const snapshot: InvoiceDraftSnapshot = {
    capturedTaxTotalPaise: v.capturedTaxTotalPaise,
    capturedTaxSplit: (v.capturedTaxSplit ?? {}) as InvoiceDraftSnapshot['capturedTaxSplit'],
    placeOfSupply: v.placeOfSupply ?? null,
    lines: v.lines.map((l) => ({ sacCode: l.sacCode ?? null })),
  };
  const flags = await runInvoiceValidations(snapshot);

  const runInsert = async () =>
    db.transaction(async (tx) =>
      insertDraftInvoice(tx as unknown as DbClient, ctx.userId, v, fyStart, flags),
    );

  let id: string;
  let documentNumber: string;
  const userNumber = v.documentNumber?.trim();
  if (userNumber) {
    // User chose the number: use it verbatim. A duplicate within the FY is a
    // clean conflict — never silently re-number the user's choice (which the
    // auto-allocation retry would otherwise do).
    try {
      ({ id, documentNumber } = await runInsert());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/duplicate key value/i.test(msg) && /document_number_per_fy_unique/i.test(msg)) {
        throw new AppError(
          'conflict',
          `Invoice number "${userNumber}" already exists for this financial year. Choose a different number.`,
        );
      }
      throw err;
    }
  } else {
    ({ id, documentNumber } = await withNumberingRetry(runInsert));
  }

  return { id, documentNumber, validationFlags: flags };
}

async function insertDraftInvoice(
  tx: DbClient,
  userId: string,
  v: z.infer<typeof CreateInvoiceInputSchema>,
  fyStart: string,
  validationFlagsToStore: ValidationFlag[],
): Promise<{ id: string; documentNumber: string }> {
  // User-supplied number wins; otherwise allocate the next in the FY series.
  // Pre-check uniqueness for the user-supplied path so a duplicate surfaces as a
  // friendly conflict rather than a raw constraint error.
  const userNumber = v.documentNumber?.trim();
  let documentNumber: string;
  if (userNumber) {
    const dupe = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.financialYearStart, fyStart), eq(invoices.documentNumber, userNumber)))
      .limit(1);
    if (dupe[0]) {
      throw new AppError(
        'conflict',
        `Invoice number "${userNumber}" already exists for this financial year. Choose a different number.`,
      );
    }
    documentNumber = userNumber;
  } else {
    ({ documentNumber } = await nextDocumentNumber('invoice', fyStart, tx));
  }

  const [row] = await tx
    .insert(invoices)
    .values({
      documentNumber,
      documentType: v.documentType ?? 'invoice',
      documentDate: v.documentDate,
      dueDate: v.dueDate ?? null,
      financialYearStart: fyStart,
      clientId: v.clientId,
      projectId: v.projectId ?? null,
      billToAddressId: v.billToAddressId ?? null,
      state: 'draft',
      subtotalPaise: v.subtotalPaise,
      capturedTaxTotalPaise: v.capturedTaxTotalPaise,
      capturedTotalPaise: v.capturedTotalPaise,
      placeOfSupply: v.placeOfSupply ?? null,
      capturedTaxSplit: serialiseTaxSplit(v.capturedTaxSplit),
      terms: v.terms ?? null,
      notes: v.notes ?? null,
      themeId: v.themeId ?? null,
      bankAccountId: v.bankAccountId ?? null,
      idempotencyKey: v.idempotencyKey,
      validationFlags: validationFlagsToStore as unknown as object[],
      createdBy: userId,
      updatedBy: userId,
    })
    .returning({ id: invoices.id });

  if (!row) {
    throw new AppError('internal', 'invoices.insert returned no row');
  }
  const invoiceId = row.id;

  await tx.insert(invoiceLines).values(
    v.lines.map((l) => ({
      invoiceId,
      lineNo: l.lineNo,
      serviceItemId: l.serviceItemId ?? null,
      description: l.description,
      sacCode: l.sacCode ?? null,
      qty: l.qty,
      ratePaise: l.ratePaise,
      capturedTaxableValuePaise: l.capturedTaxableValuePaise,
      capturedTaxRateBps: l.capturedTaxRateBps,
      capturedTaxAmountPaise: l.capturedTaxAmountPaise,
      postingAccountCode: l.postingAccountCode,
      createdBy: userId,
      updatedBy: userId,
    })),
  );

  return { id: invoiceId, documentNumber };
}

/** JSONB needs plain JSON; bigint paise → string for safe round-trip. */
function serialiseTaxSplit(split: CreateInvoiceInput['capturedTaxSplit']): Record<string, string> {
  if (!split) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(split)) {
    if (v !== undefined && v !== null) out[k] = v.toString();
  }
  return out;
}

const UpdateInvoiceInputSchema = CreateInvoiceInputSchema.partial().omit({
  idempotencyKey: true,
});

export type UpdateInvoiceInput = z.input<typeof UpdateInvoiceInputSchema>;

export async function updateDraftInvoice(
  id: string,
  input: UpdateInvoiceInput,
): Promise<{ validationFlags: ValidationFlag[] }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'create_invoice');
  const invoiceId = z.string().uuid().parse(id);

  const v = UpdateInvoiceInputSchema.parse(input);

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!current) throw new AppError('not_found', `invoice ${invoiceId} not found`);
    if (current.state !== 'draft') {
      throw new AppError(
        'ledger.posted_immutable',
        `invoice ${invoiceId} is ${current.state}; only drafts may be updated. Issue a credit note to adjust a sent invoice.`,
      );
    }

    // Header patch — only the fields the caller supplied.
    const patch: Partial<typeof invoices.$inferInsert> = { updatedBy: ctx.userId };
    if (v.clientId !== undefined) patch.clientId = v.clientId;
    if (v.projectId !== undefined) patch.projectId = v.projectId ?? null;
    if (v.documentType !== undefined) patch.documentType = v.documentType;
    if (v.billToAddressId !== undefined) patch.billToAddressId = v.billToAddressId ?? null;
    if (v.documentDate !== undefined) {
      patch.documentDate = v.documentDate;
      patch.financialYearStart = fyStartForDate(v.documentDate);
    }
    if (v.dueDate !== undefined) patch.dueDate = v.dueDate ?? null;
    // Manual number override (draft only). Reject a duplicate within the FY.
    if (v.documentNumber !== undefined && v.documentNumber?.trim()) {
      const newNum = v.documentNumber.trim();
      if (newNum !== current.documentNumber) {
        const effectiveFy = patch.financialYearStart ?? current.financialYearStart;
        const dupe = await tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(
            and(eq(invoices.financialYearStart, effectiveFy), eq(invoices.documentNumber, newNum)),
          )
          .limit(1);
        if (dupe[0]) {
          throw new AppError(
            'conflict',
            `Invoice number "${newNum}" already exists for this financial year. Choose a different number.`,
          );
        }
        patch.documentNumber = newNum;
      }
    }
    // FY moved (date change) without a number change: the existing number is
    // re-keyed into the new FY — pre-check it there too so a collision surfaces
    // as a friendly conflict rather than a raw unique-violation.
    if (
      patch.financialYearStart &&
      patch.financialYearStart !== current.financialYearStart &&
      patch.documentNumber === undefined
    ) {
      const dupe = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.financialYearStart, patch.financialYearStart),
            eq(invoices.documentNumber, current.documentNumber),
          ),
        )
        .limit(1);
      if (dupe[0]) {
        throw new AppError(
          'conflict',
          `Invoice number "${current.documentNumber}" already exists in the financial year of the new date. Change the number.`,
        );
      }
    }
    if (v.subtotalPaise !== undefined) patch.subtotalPaise = v.subtotalPaise;
    if (v.capturedTaxTotalPaise !== undefined)
      patch.capturedTaxTotalPaise = v.capturedTaxTotalPaise;
    if (v.capturedTotalPaise !== undefined) patch.capturedTotalPaise = v.capturedTotalPaise;
    if (v.placeOfSupply !== undefined) patch.placeOfSupply = v.placeOfSupply ?? null;
    if (v.capturedTaxSplit !== undefined)
      patch.capturedTaxSplit = serialiseTaxSplit(v.capturedTaxSplit);
    if (v.terms !== undefined) patch.terms = v.terms ?? null;
    if (v.notes !== undefined) patch.notes = v.notes ?? null;
    if (v.themeId !== undefined) patch.themeId = v.themeId ?? null;
    if (v.bankAccountId !== undefined) patch.bankAccountId = v.bankAccountId ?? null;

    // A newly-set project / bill-to address must belong to THIS client.
    const effectiveClientId = patch.clientId ?? current.clientId;
    if (v.projectId !== undefined) {
      await assertProjectBelongsToClient(
        v.projectId ?? null,
        effectiveClientId,
        tx as unknown as DbClient,
      );
    }
    if (v.billToAddressId !== undefined) {
      await assertBillToAddressBelongsToClient(
        v.billToAddressId ?? null,
        effectiveClientId,
        tx as unknown as DbClient,
      );
    }

    // Re-derive a full snapshot for validation by merging the patch
    // over the current row (and the new lines if supplied).
    const next: InvoiceDraftSnapshot = {
      capturedTaxTotalPaise: v.capturedTaxTotalPaise ?? (current.capturedTaxTotalPaise as bigint),
      capturedTaxSplit:
        v.capturedTaxSplit ??
        (current.capturedTaxSplit as InvoiceDraftSnapshot['capturedTaxSplit']) ??
        null,
      placeOfSupply:
        v.placeOfSupply !== undefined ? (v.placeOfSupply ?? null) : (current.placeOfSupply ?? null),
      lines:
        v.lines !== undefined
          ? v.lines.map((l) => ({ sacCode: l.sacCode ?? null }))
          : (
              await tx
                .select({ sacCode: invoiceLines.sacCode })
                .from(invoiceLines)
                .where(eq(invoiceLines.invoiceId, invoiceId))
            ).map((l) => ({ sacCode: l.sacCode })),
    };
    const flags = await runInvoiceValidations(next, tx as unknown as DbClient);
    patch.validationFlags = flags as unknown as object[];

    await tx.update(invoices).set(patch).where(eq(invoices.id, invoiceId));

    if (v.lines !== undefined) {
      // Wholesale line replacement on draft — simpler than diff-merge for v1.
      await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
      await tx.insert(invoiceLines).values(
        v.lines.map((l) => ({
          invoiceId,
          lineNo: l.lineNo,
          serviceItemId: l.serviceItemId ?? null,
          description: l.description,
          sacCode: l.sacCode ?? null,
          qty: l.qty,
          ratePaise: l.ratePaise,
          capturedTaxableValuePaise: l.capturedTaxableValuePaise,
          capturedTaxRateBps: l.capturedTaxRateBps,
          capturedTaxAmountPaise: l.capturedTaxAmountPaise,
          postingAccountCode: l.postingAccountCode,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })),
      );
    }

    return { validationFlags: flags };
  });
}

export type InvoiceWithLines = {
  invoice: typeof invoices.$inferSelect;
  lines: Array<typeof invoiceLines.$inferSelect>;
};

export async function getInvoice(id: string): Promise<InvoiceWithLines | null> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'create_invoice'); // read is gated by create — Phase 1.5 grants give the same roles read access
  const invoiceId = z.string().uuid().parse(id);
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!invoice) return null;
  const lines = await db
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId))
    .orderBy(asc(invoiceLines.lineNo));
  return { invoice, lines };
}

/**
 * The next auto-allocated invoice number for the FY of `documentDate` (today
 * when omitted). Read-only — used to PRE-FILL the composer's editable number
 * field. The actual number is still allocated atomically at create time, so a
 * concurrent create may take this exact number first; the create then rejects a
 * duplicate. Returns the FY start too so the caller can show the series.
 */
export async function getNextInvoiceNumber(
  documentDate?: string,
): Promise<{ documentNumber: string; financialYearStart: string }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'create_invoice');
  const settings = await loadBillingSettings();
  const dateIso =
    documentDate && /^\d{4}-\d{2}-\d{2}$/.test(documentDate) ? documentDate : todayIstIso();
  const fyStart = fyStartForDate(dateIso, settings.fyStartMonth);
  const { documentNumber } = await nextDocumentNumber('invoice', fyStart);
  return { documentNumber, financialYearStart: fyStart };
}

export type ListInvoicesFilters = {
  clientId?: string;
  projectId?: string;
  states?: Array<typeof invoices.$inferSelect.state>;
  documentDateFrom?: string;
  documentDateTo?: string;
  q?: string; // free-text search on document_number or notes
  limit?: number;
  offset?: number;
};

export async function listInvoices(
  filters: ListInvoicesFilters = {},
): Promise<{ rows: Array<typeof invoices.$inferSelect>; total: number }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'create_invoice');

  const conds = [];
  // Hide discarded drafts (soft-deleted). Every other billing read filters
  // this; listInvoices was the lone exception, which let discarded drafts
  // linger in the list.
  conds.push(isNull(invoices.deletedAt));
  if (filters.clientId) conds.push(eq(invoices.clientId, filters.clientId));
  if (filters.projectId) conds.push(eq(invoices.projectId, filters.projectId));
  if (filters.states && filters.states.length > 0)
    conds.push(inArray(invoices.state, filters.states));
  if (filters.documentDateFrom) conds.push(gte(invoices.documentDate, filters.documentDateFrom));
  if (filters.documentDateTo) conds.push(lte(invoices.documentDate, filters.documentDateTo));
  if (filters.q && filters.q.trim().length > 0) {
    const q = `%${filters.q.trim()}%`;
    conds.push(ilike(invoices.documentNumber, q));
  }
  const where = conds.length > 0 ? and(...conds) : undefined;

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  const rows = await db
    .select()
    .from(invoices)
    .where(where)
    .orderBy(desc(invoices.documentDate), desc(invoices.documentNumber))
    .limit(limit)
    .offset(offset);

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(invoices)
    .where(where);
  const total = totalRow?.count ?? 0;
  return { rows, total };
}

/** Convenience: today's date in IST for clients that need a default. */
export async function getInvoiceComposerDefaults(): Promise<{
  today: string;
  fyStart: string;
}> {
  const settings = await loadBillingSettings();
  const today = todayIstIso();
  return { today, fyStart: fyStartForDate(today, settings.fyStartMonth) };
}
