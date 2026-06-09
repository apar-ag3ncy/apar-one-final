'use server';

import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { documents, invoiceThemes, type InvoiceTheme } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { extractDocxTheme } from '@/lib/server/themes/extract-docx';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * Invoice-theme management actions (global, admin-managed).
 *
 * Themes are the visual skin overlaid onto the generated invoice PDF by the
 * renderer (`pdf/load-data.ts` resolves the selected/default theme inline —
 * it does NOT import this module, to keep the render path off the action
 * layer). Built-in themes are seeded by migration 0037; `docx` themes are
 * uploaded here, with brand tokens extracted at upload time.
 *
 * Reads require an authenticated actor; mutations require
 * `manage_invoice_themes` (admin/accountant; partner short-circuits).
 */

const THEME_BUCKET = 'internal-docs' as const;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_DOCX_BYTES = 10 * 1024 * 1024; // 10 MB

export type InvoiceThemeSummary = {
  id: string;
  name: string;
  kind: 'builtin' | 'docx';
  isDefault: boolean;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  fontFamily: string | null;
  hasLogo: boolean;
};

function toSummary(t: InvoiceTheme): InvoiceThemeSummary {
  return {
    id: t.id,
    name: t.name,
    kind: t.kind,
    isDefault: t.isDefault,
    primaryColor: t.primaryColor,
    secondaryColor: t.secondaryColor,
    accentColor: t.accentColor,
    fontFamily: t.fontFamily,
    hasLogo: t.logoDocumentId != null,
  };
}

/** All non-deleted themes, default first then alphabetical. */
export async function listInvoiceThemes(): Promise<InvoiceThemeSummary[]> {
  await getActorContext(); // authenticated actors only
  const rows = await db
    .select()
    .from(invoiceThemes)
    .where(isNull(invoiceThemes.deletedAt))
    .orderBy(desc(invoiceThemes.isDefault), asc(invoiceThemes.name));
  return rows.map(toSummary);
}

/**
 * Store an uploaded `.docx`, extract its brand tokens, and create a `docx`
 * theme. The original file and any extracted logo are persisted as
 * `documents` rows (entityType `invoice_theme`). Best-effort on the logo —
 * a missing/unsupported image never blocks theme creation.
 */
export async function uploadDocxTheme(formData: FormData): Promise<InvoiceThemeSummary> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_invoice_themes');

  const file = formData.get('file');
  if (!(file instanceof File)) {
    throw new AppError('validation', 'Missing or invalid .docx file in upload payload.');
  }
  if (file.size === 0) throw new AppError('validation', 'File is empty.');
  if (file.size > MAX_DOCX_BYTES) {
    throw new AppError(
      'storage.size_exceeded',
      `File exceeds ${Math.round(MAX_DOCX_BYTES / 1024 / 1024)} MB limit.`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // A .docx is an Office Open XML ZIP — must start with the local-file
  // header "PK\x03\x04".
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    throw new AppError(
      'storage.mime_mismatch',
      'Uploaded file is not a valid .docx (Office Open XML) document.',
    );
  }

  const nameRaw = (formData.get('name') as string | null)?.trim();
  const name = nameRaw && nameRaw.length > 0 ? nameRaw : file.name.replace(/\.docx$/i, '');
  const makeDefault = formData.get('isDefault') === 'true';

  const extracted = await extractDocxTheme(bytes);

  const themeId = crypto.randomUUID();
  const admin = createAdminClient();

  // 1) Upload the source .docx to storage (outside the DB tx).
  const docxPath = `invoice_themes/${themeId}/source.docx`;
  const { error: docxErr } = await admin.storage
    .from(THEME_BUCKET)
    .upload(docxPath, bytes, { contentType: DOCX_MIME, upsert: true });
  if (docxErr) {
    throw new AppError('internal', `Failed to upload theme .docx to Storage: ${docxErr.message}`);
  }

  // 2) Upload the extracted logo (best-effort).
  let logoUpload: { path: string; contentType: string; size: number; filename: string } | null =
    null;
  if (extracted.logo) {
    const logoPath = `invoice_themes/${themeId}/logo.${extracted.logo.ext}`;
    const { error: logoErr } = await admin.storage
      .from(THEME_BUCKET)
      .upload(logoPath, extracted.logo.bytes, {
        contentType: extracted.logo.contentType,
        upsert: true,
      });
    if (!logoErr) {
      logoUpload = {
        path: logoPath,
        contentType: extracted.logo.contentType,
        size: extracted.logo.bytes.byteLength,
        filename: `logo.${extracted.logo.ext}`,
      };
    }
  }

  // 3) Persist documents rows + the theme row atomically.
  const created = await db.transaction(async (tx) => {
    const [docxRow] = await tx
      .insert(documents)
      .values({
        entityType: 'invoice_theme',
        entityId: themeId,
        bucket: THEME_BUCKET,
        storagePath: docxPath,
        visibility: 'internal',
        category: 'invoice_theme_source',
        originalFilename: file.name,
        mimeType: DOCX_MIME,
        sizeBytes: bytes.byteLength,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: documents.id });

    let logoDocumentId: string | null = null;
    if (logoUpload) {
      const [logoRow] = await tx
        .insert(documents)
        .values({
          entityType: 'invoice_theme',
          entityId: themeId,
          bucket: THEME_BUCKET,
          storagePath: logoUpload.path,
          visibility: 'internal',
          category: 'invoice_theme_logo',
          originalFilename: logoUpload.filename,
          mimeType: logoUpload.contentType,
          sizeBytes: logoUpload.size,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: documents.id });
      logoDocumentId = logoRow?.id ?? null;
    }

    if (makeDefault) {
      await tx
        .update(invoiceThemes)
        .set({ isDefault: false, updatedBy: ctx.userId })
        .where(and(eq(invoiceThemes.isDefault, true), isNull(invoiceThemes.deletedAt)));
    }

    const [row] = await tx
      .insert(invoiceThemes)
      .values({
        id: themeId,
        name,
        kind: 'docx',
        isDefault: makeDefault,
        sourceDocumentId: docxRow?.id ?? null,
        logoDocumentId,
        primaryColor: extracted.primaryColor ?? null,
        secondaryColor: extracted.secondaryColor ?? null,
        accentColor: extracted.accentColor ?? null,
        fontFamily: extracted.fontFamily ?? null,
        tokens: extracted.tokens ?? {},
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    if (!row) throw new AppError('internal', 'invoice_themes insert returned no row');
    return row;
  });

  return toSummary(created);
}

/** Make `id` the single default theme (clears the prior default in a tx). */
export async function setDefaultTheme(id: string): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_invoice_themes');
  await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: invoiceThemes.id })
      .from(invoiceThemes)
      .where(and(eq(invoiceThemes.id, id), isNull(invoiceThemes.deletedAt)))
      .limit(1);
    if (!target) throw new AppError('not_found', `invoice theme ${id} not found`);
    await tx
      .update(invoiceThemes)
      .set({ isDefault: false, updatedBy: ctx.userId })
      .where(and(eq(invoiceThemes.isDefault, true), isNull(invoiceThemes.deletedAt)));
    await tx
      .update(invoiceThemes)
      .set({ isDefault: true, updatedBy: ctx.userId })
      .where(eq(invoiceThemes.id, id));
  });
}

/** Soft-delete an uploaded theme. Built-in and default themes are protected. */
export async function deleteInvoiceTheme(id: string): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_invoice_themes');
  const [target] = await db
    .select()
    .from(invoiceThemes)
    .where(and(eq(invoiceThemes.id, id), isNull(invoiceThemes.deletedAt)))
    .limit(1);
  if (!target) throw new AppError('not_found', `invoice theme ${id} not found`);
  if (target.kind === 'builtin') {
    throw new AppError('validation', 'Built-in themes cannot be deleted.');
  }
  if (target.isDefault) {
    throw new AppError('validation', 'Set another theme as default before deleting this one.');
  }
  await db
    .update(invoiceThemes)
    .set({ deletedAt: new Date(), updatedBy: ctx.userId })
    .where(eq(invoiceThemes.id, id));
}
