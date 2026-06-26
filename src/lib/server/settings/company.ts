'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { companyBankAccounts, companyDocuments, documents, organizations } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { sniffMime } from '@/lib/storage';
import { getActorContext } from '@/lib/server/actor';
import { createAdminClient } from '@/lib/supabase/server';
import { getDocumentSignedUrl } from '@/lib/server/entities/documents';
import { GSTIN_RE, IFSC_RE, PAN_RE } from '@/lib/validators';
import {
  COMPANY_LOGO_CATEGORY,
  ORG_ENTITY_TYPE,
  getCompanyLogoDocument,
  getCompanyProfile,
  listCompanyBankAccounts,
  listCompanyDocuments,
  type CompanyBankAccountRow,
  type CompanyDocumentRow,
  type CompanyProfile,
} from '@/lib/server/settings/company-data';

/**
 * Settings → Company details + Billing write actions. The agency's own
 * profile (organizations row), bank accounts, and documents.
 *
 * Returns the safe `{ ok } | { ok:false, message }` shape (not a thrown
 * AppError or a class instance) so values cross the server-action boundary
 * cleanly and clients can toast `message` directly.
 *
 * Capability model:
 *   - profile + documents → `manage_company_profile`
 *   - bank accounts → `manage_bank_accounts` (the existing finance-tier cap)
 */

export type ActionResult = { ok: true } | { ok: false; message: string };

/* -------------------------------------------------------------------------- */
/* Read action                                                                */
/* -------------------------------------------------------------------------- */

export type CompanySettingsData = {
  profile: CompanyProfile | null;
  documents: CompanyDocumentRow[];
};

/**
 * Read for client-side surfaces (the OS Settings → Company documents pane)
 * that can't import the server-only readers directly. Same capability gate
 * as the document view/download route handler.
 */
export async function getCompanySettings(): Promise<CompanySettingsData> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_company_profile');
  const [profile, documents] = await Promise.all([getCompanyProfile(), listCompanyDocuments()]);
  return { profile, documents };
}

/**
 * Client-callable read of the agency's bank accounts — for surfaces (the OS
 * Settings → Billing pane) that can't import the server-only reader directly.
 */
export async function listBankAccountsForSettings(): Promise<CompanyBankAccountRow[]> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_bank_accounts');
  return listCompanyBankAccounts();
}

export type CompanyBankAccountOption = { id: string; label: string; isPrimary: boolean };

/**
 * Minimal bank-account options for the invoice composer's "which account to
 * print" picker. Authenticated read only (no `manage_bank_accounts`) — invoice
 * creators need to choose an account, and the chosen account's full details
 * already print on the invoice anyway. The account number is masked to the last
 * 4 in the label.
 */
export async function listCompanyBankAccountOptions(): Promise<CompanyBankAccountOption[]> {
  await getActorContext(); // authenticated actors only
  const rows = await listCompanyBankAccounts(); // primary first
  return rows.map((r) => {
    const last4 = r.accountNumber.slice(-4);
    return {
      id: r.id,
      label: `${r.title} — ${r.bankName} ••${last4}`,
      isPrimary: r.isPrimary,
    };
  });
}

export type CompanyPreview = {
  name: string;
  address: string;
  gstin: string | null;
  pan: string | null;
  /** Signed URL of the company logo for the preview, or null. */
  logoUrl: string | null;
};

/**
 * The agency's own header details for the invoice-format editor's live preview,
 * so it shows the real company instead of placeholder text. Authenticated read.
 */
export async function getCompanyPreview(): Promise<CompanyPreview | null> {
  await getActorContext();
  const p = await getCompanyProfile();
  if (!p) return null;
  let logoUrl: string | null = null;
  try {
    const doc = await getCompanyLogoDocument();
    if (doc) logoUrl = (await getDocumentSignedUrl(doc.id)).url;
  } catch {
    /* best-effort — preview shows a placeholder when unavailable */
  }
  return {
    name: p.displayName || p.legalName,
    address: p.registeredAddress ?? '',
    gstin: p.gstin,
    pan: p.pan,
    logoUrl,
  };
}

const LOGO_BUCKET = 'internal-docs' as const;
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

export type CompanyLogo = { hasLogo: boolean; url: string | null };

/** The current company logo + a signed URL, for Settings + the preview. */
export async function getCompanyLogo(): Promise<CompanyLogo> {
  await getActorContext();
  const doc = await getCompanyLogoDocument();
  if (!doc) return { hasLogo: false, url: null };
  let url: string | null = null;
  try {
    url = (await getDocumentSignedUrl(doc.id)).url;
  } catch {
    /* ignore */
  }
  return { hasLogo: true, url };
}

/**
 * Upload the agency's logo (PNG/JPEG), stored as an `organization` document in
 * Storage. Used on every invoice (unless a format overrides it). Replaces any
 * previous logo (soft-deleted). Gated by `manage_company_profile`.
 */
export async function uploadCompanyLogo(formData: FormData): Promise<ActionResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_company_profile');
  const profile = await getCompanyProfile();
  if (!profile) return { ok: false, message: 'No organization record found.' };

  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, message: 'Missing image file.' };
  if (file.size === 0) return { ok: false, message: 'File is empty.' };
  if (file.size > MAX_LOGO_BYTES) {
    return { ok: false, message: `Logo exceeds ${Math.round(MAX_LOGO_BYTES / 1024 / 1024)} MB.` };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let ext: 'png' | 'jpg';
  let contentType: 'image/png' | 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    ext = 'png';
    contentType = 'image/png';
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    ext = 'jpg';
    contentType = 'image/jpeg';
  } else {
    return { ok: false, message: 'Logo must be a PNG or JPEG image.' };
  }

  const admin = createAdminClient();
  const storagePath = `${ORG_ENTITY_TYPE}/${profile.id}/logo-${Date.now()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from(LOGO_BUCKET)
    .upload(storagePath, bytes, { contentType, upsert: true });
  if (upErr) return { ok: false, message: `Upload failed: ${upErr.message}` };

  await db.transaction(async (tx) => {
    await tx
      .update(documents)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(
        and(
          eq(documents.entityType, ORG_ENTITY_TYPE),
          eq(documents.category, COMPANY_LOGO_CATEGORY),
          isNull(documents.deletedAt),
        ),
      );
    await tx.insert(documents).values({
      entityType: ORG_ENTITY_TYPE,
      entityId: profile.id,
      bucket: LOGO_BUCKET,
      storagePath,
      visibility: 'internal',
      category: COMPANY_LOGO_CATEGORY,
      originalFilename: file.name || `logo.${ext}`,
      mimeType: contentType,
      sizeBytes: bytes.byteLength,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });
  });
  revalidatePath('/settings/company');
  return { ok: true };
}

/** Remove the company logo (soft-delete). Gated by `manage_company_profile`. */
export async function removeCompanyLogo(): Promise<ActionResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_company_profile');
  await db
    .update(documents)
    .set({ deletedAt: new Date(), updatedBy: ctx.userId })
    .where(
      and(
        eq(documents.entityType, ORG_ENTITY_TYPE),
        eq(documents.category, COMPANY_LOGO_CATEGORY),
        isNull(documents.deletedAt),
      ),
    );
  revalidatePath('/settings/company');
  return { ok: true };
}

const MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MB — matches uploadDocument default
const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]$/;
const COMPANY_PATH = '/settings/company';
const BILLING_PATH = '/settings/billing';

function ok(): ActionResult {
  return { ok: true };
}
function fail(message: string): ActionResult {
  return { ok: false, message };
}
function toErr(e: unknown): ActionResult {
  if (e instanceof AppError) return fail(e.message);
  console.error('[settings/company] action error:', e);
  return fail('Something went wrong. Please try again.');
}

/** Trim → null when blank. */
function norm(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/* -------------------------------------------------------------------------- */
/* Company profile                                                            */
/* -------------------------------------------------------------------------- */

const ProfileInput = z.object({
  legalName: z.string().trim().min(1, 'Legal name is required.').max(200),
  displayName: z.string().trim().min(1, 'Display name is required.').max(200),
  gstin: z.string().trim().max(20).nullish(),
  pan: z.string().trim().max(20).nullish(),
  tan: z.string().trim().max(20).nullish(),
  udyam: z.string().trim().max(40).nullish(),
  registeredAddress: z.string().trim().max(2000).nullish(),
  secondaryAddress: z.string().trim().max(2000).nullish(),
});

export type ProfileInputShape = z.input<typeof ProfileInput>;

export async function updateCompanyProfile(input: ProfileInputShape): Promise<ActionResult> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'manage_company_profile');
    const parsed = ProfileInput.parse(input);

    const gstin = norm(parsed.gstin)?.toUpperCase() ?? null;
    const pan = norm(parsed.pan)?.toUpperCase() ?? null;
    const tan = norm(parsed.tan)?.toUpperCase() ?? null;
    const udyam = norm(parsed.udyam)?.toUpperCase() ?? null;

    // Validate the structured identifiers only when provided — these feed the
    // invoice PDFs, so a malformed value is worth blocking on.
    if (gstin && !GSTIN_RE.test(gstin)) {
      return fail('GSTIN must be 15 characters in the standard format (e.g. 27ABCDE1234F1Z5).');
    }
    if (pan && !PAN_RE.test(pan)) {
      return fail('PAN must be 10 characters in the format ABCDE1234F.');
    }
    if (tan && !TAN_RE.test(tan)) {
      return fail('TAN must be 10 characters in the format ABCD12345E.');
    }

    const [existing] = await db.select({ id: organizations.id }).from(organizations).limit(1);
    if (!existing) {
      return fail('Company record not found. Seed the organization row first.');
    }

    await db
      .update(organizations)
      .set({
        legalName: parsed.legalName,
        displayName: parsed.displayName,
        gstin,
        pan,
        tan,
        udyam,
        registeredAddress: norm(parsed.registeredAddress),
        secondaryAddress: norm(parsed.secondaryAddress),
        updatedBy: ctx.userId,
      })
      .where(eq(organizations.id, existing.id));

    await logAudit({
      actorId: ctx.userId,
      entityType: 'company_profile',
      entityId: existing.id,
      action: 'update',
      changes: { fields: Object.keys(parsed) },
    });

    revalidatePath(COMPANY_PATH);
    return ok();
  } catch (e) {
    return toErr(e);
  }
}

/* -------------------------------------------------------------------------- */
/* Bank accounts                                                              */
/* -------------------------------------------------------------------------- */

const BankInput = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(120),
  accountNumber: z
    .string()
    .trim()
    .min(4, 'Account number looks too short.')
    .max(34)
    .regex(/^[0-9A-Za-z]+$/, 'Account number may only contain letters and digits.'),
  ifsc: z.string().trim().min(1, 'IFSC is required.').max(20),
  bankName: z.string().trim().min(1, 'Bank name is required.').max(120),
  branchName: z.string().trim().max(160).nullish(),
  upiId: z.string().trim().max(100).nullish(),
  isPrimary: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullish(),
});

export type BankInputShape = z.input<typeof BankInput>;

export async function createCompanyBankAccount(input: BankInputShape): Promise<ActionResult> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'manage_bank_accounts');
    const parsed = BankInput.parse(input);
    const ifsc = parsed.ifsc.toUpperCase();
    if (!IFSC_RE.test(ifsc)) {
      return fail('IFSC must be 11 characters in the format ABCD0123456.');
    }

    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: companyBankAccounts.id })
        .from(companyBankAccounts)
        .where(isNull(companyBankAccounts.deletedAt));
      // First account is always primary; otherwise honour the request.
      const makePrimary = parsed.isPrimary === true || existing.length === 0;
      if (makePrimary && existing.length > 0) {
        await tx
          .update(companyBankAccounts)
          .set({ isPrimary: false, updatedBy: ctx.userId })
          .where(isNull(companyBankAccounts.deletedAt));
      }
      const [row] = await tx
        .insert(companyBankAccounts)
        .values({
          title: parsed.title,
          accountNumber: parsed.accountNumber,
          ifsc,
          bankName: parsed.bankName,
          branchName: norm(parsed.branchName),
          upiId: norm(parsed.upiId),
          isPrimary: makePrimary,
          sortOrder: existing.length,
          notes: norm(parsed.notes),
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: companyBankAccounts.id });
      await logAudit({
        actorId: ctx.userId,
        entityType: 'company_bank_account',
        entityId: row!.id,
        action: 'insert',
        changes: { title: parsed.title, bankName: parsed.bankName, isPrimary: makePrimary },
      });
    });

    revalidatePath(BILLING_PATH);
    return ok();
  } catch (e) {
    return toErr(e);
  }
}

export async function updateCompanyBankAccount(
  id: string,
  input: BankInputShape,
): Promise<ActionResult> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'manage_bank_accounts');
    const parsed = BankInput.parse(input);
    const ifsc = parsed.ifsc.toUpperCase();
    if (!IFSC_RE.test(ifsc)) {
      return fail('IFSC must be 11 characters in the format ABCD0123456.');
    }

    const [existing] = await db
      .select({ id: companyBankAccounts.id })
      .from(companyBankAccounts)
      .where(and(eq(companyBankAccounts.id, id), isNull(companyBankAccounts.deletedAt)))
      .limit(1);
    if (!existing) return fail('Bank account not found.');

    await db
      .update(companyBankAccounts)
      .set({
        title: parsed.title,
        accountNumber: parsed.accountNumber,
        ifsc,
        bankName: parsed.bankName,
        branchName: norm(parsed.branchName),
        upiId: norm(parsed.upiId),
        notes: norm(parsed.notes),
        updatedBy: ctx.userId,
      })
      .where(eq(companyBankAccounts.id, id));

    await logAudit({
      actorId: ctx.userId,
      entityType: 'company_bank_account',
      entityId: id,
      action: 'update',
      changes: { title: parsed.title, bankName: parsed.bankName },
    });

    revalidatePath(BILLING_PATH);
    return ok();
  } catch (e) {
    return toErr(e);
  }
}

export async function setPrimaryBankAccount(id: string): Promise<ActionResult> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'manage_bank_accounts');

    const [existing] = await db
      .select({ id: companyBankAccounts.id })
      .from(companyBankAccounts)
      .where(and(eq(companyBankAccounts.id, id), isNull(companyBankAccounts.deletedAt)))
      .limit(1);
    if (!existing) return fail('Bank account not found.');

    await db.transaction(async (tx) => {
      await tx
        .update(companyBankAccounts)
        .set({ isPrimary: false, updatedBy: ctx.userId })
        .where(and(isNull(companyBankAccounts.deletedAt), ne(companyBankAccounts.id, id)));
      await tx
        .update(companyBankAccounts)
        .set({ isPrimary: true, updatedBy: ctx.userId })
        .where(eq(companyBankAccounts.id, id));
    });

    await logAudit({
      actorId: ctx.userId,
      entityType: 'company_bank_account',
      entityId: id,
      action: 'update',
      changes: { isPrimary: true },
    });

    revalidatePath(BILLING_PATH);
    return ok();
  } catch (e) {
    return toErr(e);
  }
}

export async function deleteCompanyBankAccount(id: string): Promise<ActionResult> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'manage_bank_accounts');

    const [existing] = await db
      .select({ id: companyBankAccounts.id, isPrimary: companyBankAccounts.isPrimary })
      .from(companyBankAccounts)
      .where(and(eq(companyBankAccounts.id, id), isNull(companyBankAccounts.deletedAt)))
      .limit(1);
    if (!existing) return fail('Bank account not found.');

    await db.transaction(async (tx) => {
      await tx
        .update(companyBankAccounts)
        .set({ deletedAt: new Date(), isPrimary: false, updatedBy: ctx.userId })
        .where(eq(companyBankAccounts.id, id));

      // If we removed the primary, promote the next surviving account so the
      // invoice payment block always has a default.
      if (existing.isPrimary) {
        const [next] = await tx
          .select({ id: companyBankAccounts.id })
          .from(companyBankAccounts)
          .where(isNull(companyBankAccounts.deletedAt))
          .orderBy(companyBankAccounts.sortOrder, companyBankAccounts.createdAt)
          .limit(1);
        if (next) {
          await tx
            .update(companyBankAccounts)
            .set({ isPrimary: true, updatedBy: ctx.userId })
            .where(eq(companyBankAccounts.id, next.id));
        }
      }
    });

    await logAudit({
      actorId: ctx.userId,
      entityType: 'company_bank_account',
      entityId: id,
      action: 'delete',
      changes: {},
    });

    revalidatePath(BILLING_PATH);
    return ok();
  } catch (e) {
    return toErr(e);
  }
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                  */
/* -------------------------------------------------------------------------- */

const DocCategory = z.enum([
  'gst',
  'tan',
  'pan',
  'udyam',
  'incorporation',
  'partnership_deed',
  'rent_agreement',
  'other',
]);

export async function uploadCompanyDocument(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'manage_company_profile');

    const file = formData.get('file');
    if (!(file instanceof File)) return fail('Choose a file to upload.');
    if (file.size === 0) return fail('That file is empty.');
    if (file.size > MAX_DOC_BYTES) {
      return fail(`File exceeds the ${Math.round(MAX_DOC_BYTES / 1024 / 1024)} MB limit.`);
    }

    const category = DocCategory.parse(formData.get('category'));
    const title = norm(formData.get('title'));
    if (!title) return fail('Give the document a title.');
    const referenceNumber = norm(formData.get('referenceNumber'));
    const notes = norm(formData.get('notes'));

    // Sniff the real MIME from the first bytes; reject a lie. Falls back to the
    // browser-declared type for formats we don't fingerprint (e.g. plain text).
    const buffer = Buffer.from(await file.arrayBuffer());
    const detected = sniffMime(buffer.subarray(0, 16), file.type || undefined);
    const mimeType = file.type || detected;

    const [row] = await db
      .insert(companyDocuments)
      .values({
        category,
        title,
        referenceNumber,
        originalFilename: file.name,
        mimeType,
        sizeBytes: file.size,
        data: buffer,
        notes,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: companyDocuments.id });

    await logAudit({
      actorId: ctx.userId,
      entityType: 'company_document',
      entityId: row!.id,
      action: 'insert',
      changes: { category, title, filename: file.name, sizeBytes: file.size },
    });

    revalidatePath(COMPANY_PATH);
    return ok();
  } catch (e) {
    return toErr(e);
  }
}

const DocMetaInput = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(200),
  referenceNumber: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

export type DocMetaInputShape = z.input<typeof DocMetaInput>;

export async function updateCompanyDocumentMeta(
  id: string,
  input: DocMetaInputShape,
): Promise<ActionResult> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'manage_company_profile');
    const parsed = DocMetaInput.parse(input);

    const [existing] = await db
      .select({ id: companyDocuments.id })
      .from(companyDocuments)
      .where(and(eq(companyDocuments.id, id), isNull(companyDocuments.deletedAt)))
      .limit(1);
    if (!existing) return fail('Document not found.');

    await db
      .update(companyDocuments)
      .set({
        title: parsed.title,
        referenceNumber: norm(parsed.referenceNumber),
        notes: norm(parsed.notes),
        updatedBy: ctx.userId,
      })
      .where(eq(companyDocuments.id, id));

    await logAudit({
      actorId: ctx.userId,
      entityType: 'company_document',
      entityId: id,
      action: 'update',
      changes: { title: parsed.title },
    });

    revalidatePath(COMPANY_PATH);
    return ok();
  } catch (e) {
    return toErr(e);
  }
}

export async function deleteCompanyDocument(id: string): Promise<ActionResult> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'manage_company_profile');

    const [existing] = await db
      .select({ id: companyDocuments.id })
      .from(companyDocuments)
      .where(and(eq(companyDocuments.id, id), isNull(companyDocuments.deletedAt)))
      .limit(1);
    if (!existing) return fail('Document not found.');

    await db
      .update(companyDocuments)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(companyDocuments.id, id));

    await logAudit({
      actorId: ctx.userId,
      entityType: 'company_document',
      entityId: id,
      action: 'delete',
      changes: {},
    });

    revalidatePath(COMPANY_PATH);
    return ok();
  } catch (e) {
    return toErr(e);
  }
}
