'use server';

import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logActivity } from '@/lib/activity';
import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import {
  clients,
  entityAddresses,
  entityBankAccounts,
  entityContacts,
  entityTaxIdentifiers,
  transactions,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { GSTIN_RE, IFSC_RE, PAN_RE, last4 } from '@/lib/validators';

/**
 * Client write actions. Mirrors SPEC-AMENDMENT-001 §2.1 + §2.4:
 *
 *   - `archiveClient` / `archiveClients` (bulk) — soft-delete; admin or
 *     partner. RLS still allows partner/admin to read archived rows.
 *   - `restoreClient` — partner only (capability `restore_client`).
 *   - `hardDeleteClient` — partner only, refuses if any non-reversed
 *     transactions reference the client. AUDIT-GAPS §2.4 dependents check.
 *
 * Soft-delete column is `is_archived` + `archived_at` / `archived_by`.
 * `deleted_at` exists on the row for the polymorphic-shared timestamp
 * mixin but is NOT used for the entity-level archive flow — the
 * `is_archived` boolean is what UI surfaces filter on.
 */

const ClientIdSchema = z.string().uuid();

export async function archiveClient(id: string): Promise<void> {
  await archiveClients([id]);
}

export async function archiveClients(ids: readonly string[]): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'archive_client');
  const parsed = ids.map((id) => ClientIdSchema.parse(id));
  if (parsed.length === 0) return;

  await db
    .update(clients)
    .set({
      isArchived: true,
      archivedAt: new Date(),
      archivedBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .where(
      and(
        inArray(clients.id, parsed as string[]),
        eq(clients.isArchived, false),
        isNull(clients.deletedAt),
      ),
    );
}

export async function restoreClient(id: string): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'restore_client');
  await db
    .update(clients)
    .set({
      isArchived: false,
      archivedAt: null,
      archivedBy: null,
      updatedBy: ctx.userId,
    })
    .where(and(eq(clients.id, id), isNull(clients.deletedAt)));
}

/**
 * Partner-only hard delete with the §2.4 dependents check.
 *
 * Refuses if any non-reversed transaction references the client as
 * `on_behalf_of_client_id`. UI surfaces the count and tells the user to
 * reverse them first.
 */
export async function hardDeleteClient(id: string): Promise<void> {
  const ctx = await getActorContext();
  if (ctx.role !== 'partner') {
    throw new AppError('forbidden', 'Hard delete of a client is restricted to the partner role.', {
      detail: { role: ctx.role },
    });
  }

  // Dependents check: any non-reversed transaction referencing this client.
  // Reversed entries are historical and don't block deletion (matches the
  // vendors/projects/employees rule).
  const refs = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.onBehalfOfClientId, id), ne(transactions.status, 'reversed')))
    .limit(1);
  if (refs.length > 0) {
    throw new AppError(
      'conflict',
      'This client has transactions referencing it. Reverse those first or archive the client instead.',
      { detail: { entity: 'client', id } },
    );
  }

  await db.delete(clients).where(eq(clients.id, id));
}

export async function hardDeleteClients(ids: readonly string[]): Promise<{
  deleted: number;
  blocked: string[];
}> {
  const ctx = await getActorContext();
  if (ctx.role !== 'partner') {
    throw new AppError('forbidden', 'Hard delete of a client is restricted to the partner role.', {
      detail: { role: ctx.role },
    });
  }
  const parsed = ids.map((id) => ClientIdSchema.parse(id));
  if (parsed.length === 0) return { deleted: 0, blocked: [] };

  const refs = await db
    .select({ id: transactions.onBehalfOfClientId })
    .from(transactions)
    .where(
      and(
        inArray(transactions.onBehalfOfClientId, parsed as string[]),
        ne(transactions.status, 'reversed'),
      ),
    );
  const blockedSet = new Set<string>();
  for (const r of refs) {
    if (r.id) blockedSet.add(r.id);
  }
  const deletable = parsed.filter((id) => !blockedSet.has(id));
  if (deletable.length === 0) {
    return { deleted: 0, blocked: Array.from(blockedSet) };
  }
  await db.delete(clients).where(inArray(clients.id, deletable as string[]));
  return { deleted: deletable.length, blocked: Array.from(blockedSet) };
}

/* -------------------------------------------------------------------------- */
/* createClient — backs the 7-step ClientWizard at /clients/new               */
/* -------------------------------------------------------------------------- */

const CreateContactSchema = z
  .object({
    name: z.string().trim().min(1),
    role: z.string().trim().max(120).optional(),
    email: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(40).optional(),
    isPrimary: z.boolean().optional(),
  })
  .refine((c) => (c.email && c.email.length > 0) || (c.phone && c.phone.length > 0), {
    message: 'Each contact needs at least one of email or phone.',
    path: ['email'],
  });

const CreateBankSchema = z
  .object({
    bankName: z.string().trim().max(200).optional(),
    accountNumber: z.string().trim().max(60).optional(),
    ifsc: z.string().trim().max(20).optional(),
    holderName: z.string().trim().max(200).optional(),
  })
  .refine(
    (b) => {
      // All-empty is fine (banking is optional); but if anything is
      // filled, every field except holderName is required.
      const any =
        (b.bankName ?? '') !== '' ||
        (b.accountNumber ?? '') !== '' ||
        (b.ifsc ?? '') !== '' ||
        (b.holderName ?? '') !== '';
      if (!any) return true;
      return Boolean(b.bankName && b.accountNumber && b.ifsc);
    },
    {
      message: 'Bank name, account number and IFSC are required when adding a bank account.',
      path: ['bankName'],
    },
  )
  .refine((b) => !b.ifsc || IFSC_RE.test(b.ifsc.toUpperCase()), {
    message: 'IFSC format looks off — expected 4 letters + 0 + 6 alphanumerics.',
    path: ['ifsc'],
  });

const CreateContractSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('signed'),
    uploadedFileName: z.string().trim().min(1),
    signedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Signed-on date must be YYYY-MM-DD'),
  }),
  z.object({
    kind: z.literal('pending'),
    reason: z.string().trim().min(1),
    expectedBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected-by date must be YYYY-MM-DD'),
  }),
  // 'waived' supports the OS quick-create which doesn't gather contract
  // details upfront (mirrors createVendor).
  z.object({ kind: z.literal('waived'), reason: z.string().trim().optional() }),
]);

const CreateClientSchema = z.object({
  name: z.string().trim().min(1, 'Legal name is required'),
  legalType: z
    .enum(['individual', 'sole_prop', 'partnership', 'llp', 'pvt_ltd', 'public_ltd'])
    .optional(),
  industry: z.string().trim().max(160).optional(),
  status: z.enum(['prospect', 'active', 'inactive']).optional(),
  accountManagerId: z.string().uuid().optional(),
  primaryEmail: z.string().trim().max(200).optional(),
  primaryPhone: z.string().trim().max(40).optional(),
  pan: z.string().trim().toUpperCase().optional(),
  gstin: z.string().trim().toUpperCase().optional(),
  msme: z.string().trim().max(60).optional(),
  registeredAddress: z.string().trim().max(2000).optional(),
  // Optional so the OS quick-create can omit them; the dashboard wizard
  // still requires ≥1 contact + a signed/pending contract client-side.
  contacts: z.array(CreateContactSchema).optional(),
  bank: CreateBankSchema.optional(),
  contract: CreateContractSchema.optional(),
});

export type CreateClientInput = z.input<typeof CreateClientSchema>;

export type CreateClientResult =
  | { ok: true; id: string }
  | { ok: false; message: string; errors: Record<string, string> };

const STATE_CODE_FROM_GSTIN: Record<string, string> = {
  '01': 'JK',
  '02': 'HP',
  '03': 'PB',
  '04': 'CH',
  '05': 'UK',
  '06': 'HR',
  '07': 'DL',
  '08': 'RJ',
  '09': 'UP',
  '10': 'BR',
  '11': 'SK',
  '12': 'AR',
  '13': 'NL',
  '14': 'MN',
  '15': 'MZ',
  '16': 'TR',
  '17': 'ML',
  '18': 'AS',
  '19': 'WB',
  '20': 'JH',
  '21': 'OD',
  '22': 'CG',
  '23': 'MP',
  '24': 'GJ',
  '26': 'DN',
  '27': 'MH',
  '29': 'KA',
  '30': 'GA',
  '31': 'LD',
  '32': 'KL',
  '33': 'TN',
  '34': 'PY',
  '35': 'AN',
  '36': 'TG',
  '37': 'AP',
  '38': 'LA',
};

function stateFromGstin(gstin: string | undefined): string | null {
  if (!gstin || gstin.length < 2) return null;
  return STATE_CODE_FROM_GSTIN[gstin.slice(0, 2)] ?? null;
}

function zodErrorsToPathMap(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.');
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

/**
 * Create a client with its child contacts / banking / tax identifiers /
 * registered address in a single transaction. Contract gating
 * (AUDIT-GAPS §1.3 + SPEC-AMENDMENT-001):
 *
 *   - `signed`  → contract_status='signed' is persisted; the wizard's
 *                 file-upload step records the filename in notes until
 *                 the storage upload pipeline lands (separate spec).
 *   - `pending` → contract_status='pending' with reason + expected-by.
 *
 * Returns a discriminated result; the wizard maps field paths in the
 * `errors` record back to its inputs.
 */
export async function createClient(input: CreateClientInput): Promise<CreateClientResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'create_client');

  const parsed = CreateClientSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Please fix the highlighted fields.',
      errors: zodErrorsToPathMap(parsed.error),
    };
  }
  const v = parsed.data;

  // Format checks on captured identifiers (CLAUDE rules #20, #21).
  const fieldErrors: Record<string, string> = {};
  if (v.pan && !PAN_RE.test(v.pan)) {
    fieldErrors.pan = 'PAN must look like ABCDE1234F.';
  }
  if (v.gstin && !GSTIN_RE.test(v.gstin)) {
    fieldErrors.gstin = 'GSTIN must be 15 characters like 27ABCDE1234F1Z5.';
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, message: 'Please fix the highlighted fields.', errors: fieldErrors };
  }

  // Active-name de-dup. Two clients with the same name can't coexist on
  // the live list — case-insensitive match against non-archived,
  // non-deleted rows. Archived/deleted rows are exempt so a freed-up
  // name can be reused. This also catches the OS quick-create
  // double-submit case before the row hits the table.
  const dup = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(
      and(
        sql`lower(${clients.name}) = lower(${v.name})`,
        eq(clients.isArchived, false),
        isNull(clients.deletedAt),
      ),
    )
    .limit(1);
  if (dup.length > 0) {
    return {
      ok: false,
      message: `A client named "${dup[0]!.name}" already exists.`,
      errors: { name: 'A client with this name already exists.' },
    };
  }

  const contractRaw = v.contract ?? { kind: 'waived' as const };

  // Server-side contract gating — final say. The wizard validates the
  // same conditions but the server enforces them regardless of UI.
  if (contractRaw.kind === 'pending') {
    const today = new Date().toISOString().slice(0, 10);
    const limit = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (contractRaw.expectedBy < today) {
      return {
        ok: false,
        message: 'Pending contracts need a future expected-by date.',
        errors: { 'contract.expectedBy': 'Date must be in the future.' },
      };
    }
    if (contractRaw.expectedBy > limit) {
      return {
        ok: false,
        message: 'Pending contracts must be expected within 30 days.',
        errors: { 'contract.expectedBy': 'Pick a date within 30 days.' },
      };
    }
  }

  // Make the contract context survive across transaction blocks
  // without re-narrowing — we touched the discriminated union above.
  const contract = contractRaw;
  const contacts = v.contacts ?? [];
  const bank = v.bank ?? {};

  try {
    const newId = await db.transaction(async (tx) => {
      const baseNotes =
        contract.kind === 'signed' ? `Signed contract on file: ${contract.uploadedFileName}` : null;

      const [row] = await tx
        .insert(clients)
        .values({
          name: v.name,
          industry: v.industry || null,
          status: v.status ?? 'active',
          accountManagerId: v.accountManagerId || null,
          gstin: v.gstin || null,
          pan: v.pan || null,
          contractStatus: contract.kind,
          contractPendingReason: contract.kind === 'pending' ? contract.reason : null,
          contractPendingUntil: contract.kind === 'pending' ? contract.expectedBy : null,
          notes: baseNotes,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: clients.id });

      if (!row) {
        throw new AppError('internal', 'Client insert returned no row.');
      }
      const clientId = row.id;

      // POCs — at least one with email-or-phone (CHECK + Zod).
      if (contacts.length > 0) {
        await tx.insert(entityContacts).values(
          contacts.map((c, idx) => ({
            entityType: 'client' as const,
            entityId: clientId,
            name: c.name,
            role: c.role || null,
            email: c.email || null,
            phone: c.phone || null,
            isPrimary: c.isPrimary ?? idx === 0,
            createdBy: ctx.userId,
            updatedBy: ctx.userId,
          })),
        );
      }

      // Tax identifiers — captured plaintext for B2B counterparties
      // (BACKEND-AUDIT §4 #4). Vault not needed for client GSTIN/PAN.
      const taxRows: Array<typeof entityTaxIdentifiers.$inferInsert> = [];
      if (v.pan) {
        taxRows.push({
          entityType: 'client',
          entityId: clientId,
          kind: 'pan',
          maskedValue: v.pan,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
      }
      if (v.gstin) {
        taxRows.push({
          entityType: 'client',
          entityId: clientId,
          kind: 'gstin',
          maskedValue: v.gstin,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
      }
      if (v.msme) {
        taxRows.push({
          entityType: 'client',
          entityId: clientId,
          kind: 'msme_udyam',
          maskedValue: v.msme,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
      }
      if (taxRows.length > 0) {
        await tx.insert(entityTaxIdentifiers).values(taxRows);
      }

      // Registered address — one row of kind='registered'. The state
      // code is derived from the GSTIN when present; otherwise default
      // to 'MH' (HQ state) so the NOT NULL constraint is satisfied.
      if (v.registeredAddress) {
        await tx.insert(entityAddresses).values({
          entityType: 'client',
          entityId: clientId,
          kind: 'registered',
          line1: v.registeredAddress.slice(0, 250),
          city: '—',
          stateCode: stateFromGstin(v.gstin) ?? 'MH',
          country: 'IN',
          gstin: v.gstin || null,
          isPrimary: true,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
      }

      // Bank account — optional. Vault upload not wired yet; we store
      // the last-4 + IFSC + holder + an empty vaultObjectKey so the
      // row is queryable. The reveal flow will refuse to surface a
      // full number until storage upload lands.
      const b = bank;
      const bankFilled =
        (b.bankName ?? '') !== '' || (b.accountNumber ?? '') !== '' || (b.ifsc ?? '') !== '';
      if (bankFilled) {
        const acct = (b.accountNumber ?? '').replace(/\s+/g, '');
        await tx.insert(entityBankAccounts).values({
          entityType: 'client',
          entityId: clientId,
          holderName: (b.holderName?.trim() || v.name).slice(0, 200),
          accountLast4: acct.length >= 4 ? last4(acct) : '0000',
          ifsc: (b.ifsc ?? '').toUpperCase(),
          bankName: b.bankName ?? '',
          accountType: 'current',
          isPrimary: true,
          vaultObjectKey: '', // populated when storage upload ships
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
      }

      return clientId;
    });

    await logAudit({
      actorId: ctx.userId,
      entityType: 'client',
      entityId: newId,
      action: 'insert',
      changes: { name: { before: null, after: v.name } },
    });
    await logActivity({
      entityType: 'client',
      entityId: newId,
      actorId: ctx.userId,
      kind: 'entity.created',
      summary: `Client "${v.name}" created`,
    });

    return { ok: true, id: newId };
  } catch (e) {
    // Unique violation on the partial index `clients_name_unique_active`
    // (migration 0029). Reached only when two concurrent inserts both
    // pass the app-side pre-check; surface it as a `name` field error
    // so the form highlights the right input.
    const code =
      typeof e === 'object' && e !== null && 'code' in e ? (e as { code?: unknown }).code : null;
    if (code === '23505') {
      return {
        ok: false,
        message: `A client named "${v.name}" already exists.`,
        errors: { name: 'A client with this name already exists.' },
      };
    }
    const message =
      e instanceof AppError
        ? e.message
        : e instanceof Error
          ? e.message
          : 'Could not create the client.';
    return { ok: false, message, errors: {} };
  }
}

/* -------------------------------------------------------------------------- */
/* updateClient — backs the OS "Edit Client" modal                            */
/* -------------------------------------------------------------------------- */

const UpdateClientSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'Client name is required').optional(),
  industry: z.string().trim().max(160).nullable().optional(),
  status: z.enum(['prospect', 'active', 'inactive']).optional(),
  gstin: z.string().trim().toUpperCase().nullable().optional(),
  pan: z.string().trim().toUpperCase().nullable().optional(),
  accountManagerId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  // Registered address (a child `entity_addresses` row of kind='registered').
  // `undefined` leaves it untouched; a non-empty string upserts the primary
  // registered address; an empty string / null is treated as "no change" so an
  // in-flight load can never silently wipe an existing address. Surfacing it
  // here lets the OS "Edit client" dialog edit the address that India B2B GST
  // invoicing requires, alongside GSTIN + PAN.
  registeredAddress: z.string().trim().max(2000).nullable().optional(),
});

export type UpdateClientInput = z.input<typeof UpdateClientSchema>;

export type UpdateClientResult =
  | { ok: true }
  | { ok: false; message: string; errors: Record<string, string> };

/**
 * Patch the parent `clients` row. Polymorphic children (contacts /
 * addresses / banking / tax identifiers) are owned by their own editors;
 * this is the OS quick-edit modal's path. Mirrors `updateVendor`:
 * `null` clears a column, `undefined` leaves it untouched. Format-checks
 * GSTIN/PAN and refuses a rename that collides with another active client
 * (the `clients_name_unique_active` partial index is the real guard).
 */
export async function updateClient(input: UpdateClientInput): Promise<UpdateClientResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'update_client');

  const parsed = UpdateClientSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Please fix the highlighted fields.',
      errors: zodErrorsToPathMap(parsed.error),
    };
  }
  const v = parsed.data;

  const fieldErrors: Record<string, string> = {};
  if (v.gstin && !GSTIN_RE.test(v.gstin)) {
    fieldErrors.gstin = 'GSTIN must be 15 characters like 27ABCDE1234F1Z5.';
  }
  if (v.pan && !PAN_RE.test(v.pan)) {
    fieldErrors.pan = 'PAN must look like ABCDE1234F.';
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, message: 'Please fix the highlighted fields.', errors: fieldErrors };
  }

  // Refuse a rename that would collide with another active client.
  if (v.name) {
    const dup = await db
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(
          ne(clients.id, v.id),
          eq(clients.isArchived, false),
          isNull(clients.deletedAt),
          sql`lower(${clients.name}) = lower(${v.name})`,
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      return {
        ok: false,
        message: `A client named "${v.name}" already exists.`,
        errors: { name: 'A client with this name already exists.' },
      };
    }
  }

  const patch: Partial<typeof clients.$inferInsert> = { updatedBy: ctx.userId };
  if (v.name !== undefined) patch.name = v.name;
  if (v.industry !== undefined) patch.industry = v.industry;
  if (v.status !== undefined) patch.status = v.status;
  if (v.gstin !== undefined) patch.gstin = v.gstin;
  if (v.pan !== undefined) patch.pan = v.pan;
  if (v.accountManagerId !== undefined) patch.accountManagerId = v.accountManagerId;
  if (v.notes !== undefined) patch.notes = v.notes;

  try {
    // The parent-row update and the registered-address upsert run in ONE
    // transaction so a failed address write rolls back the client edit too
    // (mirrors createClient's all-or-nothing semantics).
    const txResult = await db.transaction(async (tx) => {
      const updated = await tx
        .update(clients)
        .set(patch)
        .where(and(eq(clients.id, v.id), isNull(clients.deletedAt)))
        .returning({ id: clients.id, name: clients.name });
      const client = updated[0];
      if (!client) return null;

      // Keep the registered address (a child `entity_addresses` row) consistent
      // with the client. Two independent triggers:
      //   (a) the address text was supplied  → upsert `line1` of the registered row;
      //   (b) the GSTIN was part of this save → re-sync the registered row's state
      //       code + per-address GSTIN, so a non-Maharashtra GSTIN added AFTER the
      //       address can never leave a stale state code on the generated invoice.
      // Only the kind='registered' row is ever touched, so a separately-managed
      // billing/site address can never be clobbered. `gstinProvided` distinguishes
      // "GSTIN omitted from this patch" from "GSTIN explicitly cleared" (→ null).
      const gstinProvided = v.gstin !== undefined;
      const addressText =
        v.registeredAddress === undefined ? undefined : (v.registeredAddress ?? '').trim();
      const wantAddressUpsert = addressText !== undefined && addressText.length > 0;

      let addressChange: 'added' | 'updated' | null = null;

      if (wantAddressUpsert || gstinProvided) {
        // GSTIN to derive the place-of-supply state from: the patched value when
        // supplied (null = cleared), otherwise the client's current value.
        let gstinForState: string | null;
        if (gstinProvided) {
          gstinForState = v.gstin ?? null;
        } else {
          const [cur] = await tx
            .select({ gstin: clients.gstin })
            .from(clients)
            .where(eq(clients.id, v.id))
            .limit(1);
          gstinForState = cur?.gstin ?? null;
        }
        const derivedState = stateFromGstin(gstinForState ?? undefined);

        const [existing] = await tx
          .select()
          .from(entityAddresses)
          .where(
            and(
              eq(entityAddresses.entityType, 'client'),
              eq(entityAddresses.entityId, v.id),
              eq(entityAddresses.kind, 'registered'),
              isNull(entityAddresses.deletedAt),
            ),
          )
          .limit(1);

        if (existing) {
          const set: Partial<typeof entityAddresses.$inferInsert> = { updatedBy: ctx.userId };
          if (wantAddressUpsert) set.line1 = addressText!.slice(0, 250);
          if (gstinProvided) {
            // Track the client GSTIN exactly — including an explicit clear (→ null)
            // so the address never carries a deleted GSTIN. Only overwrite the
            // state code when we can actually derive one (a cleared GSTIN leaves
            // the prior state, the best signal we have).
            set.gstin = gstinForState;
            if (derivedState) set.stateCode = derivedState;
          } else if (derivedState) {
            set.stateCode = derivedState;
            set.gstin = gstinForState;
          }
          if (Object.keys(set).length > 1) {
            await tx.update(entityAddresses).set(set).where(eq(entityAddresses.id, existing.id));
            if (wantAddressUpsert) addressChange = 'updated';
          }
        } else if (wantAddressUpsert) {
          // No registered row yet — create one, demoting any current primary so
          // the single-primary-per-entity invariant holds (mirrors createAddress).
          await tx
            .update(entityAddresses)
            .set({ isPrimary: false, updatedBy: ctx.userId })
            .where(
              and(
                eq(entityAddresses.entityType, 'client'),
                eq(entityAddresses.entityId, v.id),
                eq(entityAddresses.isPrimary, true),
                isNull(entityAddresses.deletedAt),
              ),
            );
          await tx.insert(entityAddresses).values({
            entityType: 'client',
            entityId: v.id,
            kind: 'registered',
            line1: addressText!.slice(0, 250),
            city: '—',
            stateCode: derivedState ?? 'MH',
            country: 'IN',
            gstin: gstinForState,
            isPrimary: true,
            createdBy: ctx.userId,
            updatedBy: ctx.userId,
          });
          addressChange = 'added';
        }
      }

      return { client, addressChange, addressText };
    });

    if (!txResult) {
      return { ok: false, message: 'Client not found.', errors: {} };
    }

    // Audit trail: reflect the parent-row patch AND the registered-address
    // mutation (a billing-critical field) so an address-only edit isn't recorded
    // as an empty change set.
    const auditChanges: Record<string, { before: null; after: unknown }> = Object.fromEntries(
      Object.entries(patch)
        .filter(([k]) => k !== 'updatedBy')
        .map(([k, val]) => [k, { before: null, after: val }]),
    );
    if (txResult.addressChange) {
      auditChanges.registeredAddress = { before: null, after: txResult.addressText ?? null };
    }

    await logAudit({
      actorId: ctx.userId,
      entityType: 'client',
      entityId: v.id,
      action: 'update',
      changes: auditChanges,
    });
    await logActivity({
      entityType: 'client',
      entityId: v.id,
      actorId: ctx.userId,
      kind: 'entity.updated',
      summary: txResult.addressChange
        ? `Client "${txResult.client.name}" updated (registered address ${txResult.addressChange})`
        : `Client "${txResult.client.name}" updated`,
    });

    return { ok: true };
  } catch (e) {
    const code =
      typeof e === 'object' && e !== null && 'code' in e ? (e as { code?: unknown }).code : null;
    if (code === '23505') {
      return {
        ok: false,
        message: `A client named "${v.name ?? v.id}" already exists.`,
        errors: { name: 'A client with this name already exists.' },
      };
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Could not update the client.',
      errors: {},
    };
  }
}
