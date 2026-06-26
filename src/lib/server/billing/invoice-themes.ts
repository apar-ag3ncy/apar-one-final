'use server';

import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { documents, invoiceThemes, type InvoiceTheme } from '@/lib/db/schema';
import { sanitizeInvoiceLayout, type InvoiceLayout } from '@/lib/billing/invoice-layout';
import { sanitizeInvoiceStyle, type InvoiceStyle } from '@/lib/billing/invoice-style';
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
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB — react-pdf inlines it as base64

export type InvoiceThemeSummary = {
  id: string;
  name: string;
  kind: 'builtin' | 'docx';
  isDefault: boolean;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  fontFamily: string | null;
  headerText: string | null;
  footerText: string | null;
  hasLogo: boolean;
  /** Came from a .docx upload (vs created/edited by hand in the editor). */
  imported: boolean;
  /** Built-in themes are read-only; everything else can be edited/deleted. */
  editable: boolean;
  /** Block placement for the PDF (sanitised; defaults reproduce the classic layout). */
  layout: InvoiceLayout;
  /** Visual style tokens (font scale, density, logo size, polish flags). */
  style: InvoiceStyle;
};

/** Read the persisted layout out of the theme's `tokens` jsonb bag. */
function readLayout(tokens: unknown): InvoiceLayout {
  const bag = (tokens && typeof tokens === 'object' ? tokens : {}) as Record<string, unknown>;
  return sanitizeInvoiceLayout(bag.layout);
}

/** Read the persisted style out of the theme's `tokens` jsonb bag. */
function readStyle(tokens: unknown): InvoiceStyle {
  const bag = (tokens && typeof tokens === 'object' ? tokens : {}) as Record<string, unknown>;
  return sanitizeInvoiceStyle(bag.style);
}

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
    headerText: t.headerText,
    footerText: t.footerText,
    hasLogo: t.logoDocumentId != null,
    imported: t.sourceDocumentId != null,
    editable: t.kind !== 'builtin',
    layout: readLayout(t.tokens),
    style: readStyle(t.tokens),
  };
}

// react-pdf can only lay out these three built-in font families. Kept local:
// a 'use server' module may only EXPORT async functions, so the client-side
// font list lives in `@/lib/billing/invoice-fonts` instead.
const INVOICE_FONTS = ['Helvetica', 'Times-Roman', 'Courier'] as const;
type InvoiceFont = (typeof INVOICE_FONTS)[number];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function normColor(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return HEX_RE.test(t) ? t.toUpperCase() : null;
}
function normFont(v: unknown): InvoiceFont | null {
  return typeof v === 'string' && (INVOICE_FONTS as readonly string[]).includes(v)
    ? (v as InvoiceFont)
    : null;
}
function normText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t.slice(0, max) : null;
}

export type InvoiceThemeEditInput = {
  name: string;
  headerText?: string | null;
  footerText?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  fontFamily?: string | null;
  makeDefault?: boolean;
  /** Block placement. Omit to leave a theme's existing layout untouched. */
  layout?: InvoiceLayout | null;
  /** Visual style tokens. Omit to leave a theme's existing style untouched. */
  style?: InvoiceStyle | null;
};

/**
 * Merge the (possibly omitted) layout + style into a theme's `tokens` jsonb bag,
 * sanitising both and preserving any other keys (e.g. docx-extracted tokens).
 * When a field is omitted by the caller, the value already stored is kept.
 */
function mergeTokens(
  existingTokens: unknown,
  input: InvoiceThemeEditInput,
): Record<string, unknown> {
  const bag = (
    existingTokens && typeof existingTokens === 'object' ? existingTokens : {}
  ) as Record<string, unknown>;
  const layoutSource = 'layout' in input ? input.layout : bag.layout;
  const styleSource = 'style' in input ? input.style : bag.style;
  return {
    ...bag,
    layout: sanitizeInvoiceLayout(layoutSource),
    style: sanitizeInvoiceStyle(styleSource),
  };
}

/**
 * Create a hand-authored ("custom") invoice theme — the dynamic
 * invoice-format editor's "new format" path. Stored as a `docx`-kind row
 * with no source document (so it's editable + deletable, unlike built-ins).
 */
export async function createInvoiceTheme(
  input: InvoiceThemeEditInput,
): Promise<InvoiceThemeSummary> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_invoice_themes');
  const name = normText(input.name, 120);
  if (!name) throw new AppError('validation', 'Give the invoice format a name.');

  const row = await db.transaction(async (tx) => {
    if (input.makeDefault) {
      await tx
        .update(invoiceThemes)
        .set({ isDefault: false, updatedBy: ctx.userId })
        .where(and(eq(invoiceThemes.isDefault, true), isNull(invoiceThemes.deletedAt)));
    }
    const [created] = await tx
      .insert(invoiceThemes)
      .values({
        name,
        kind: 'docx',
        isDefault: Boolean(input.makeDefault),
        primaryColor: normColor(input.primaryColor),
        secondaryColor: normColor(input.secondaryColor),
        accentColor: normColor(input.accentColor),
        fontFamily: normFont(input.fontFamily),
        headerText: normText(input.headerText, 60),
        footerText: normText(input.footerText, 240),
        tokens: mergeTokens({}, input),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    return created!;
  });
  return toSummary(row);
}

/**
 * Edit an existing non-builtin theme's brand tokens + header/footer text.
 * Built-in themes are immutable. `makeDefault` promotes it in the same tx.
 */
export async function updateInvoiceTheme(
  id: string,
  input: InvoiceThemeEditInput,
): Promise<InvoiceThemeSummary> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_invoice_themes');
  const name = normText(input.name, 120);
  if (!name) throw new AppError('validation', 'Give the invoice format a name.');

  const row = await db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(invoiceThemes)
      .where(and(eq(invoiceThemes.id, id), isNull(invoiceThemes.deletedAt)))
      .limit(1);
    if (!target) throw new AppError('not_found', `invoice theme ${id} not found`);
    if (target.kind === 'builtin') {
      throw new AppError(
        'validation',
        'Built-in formats are read-only. Duplicate it to customise.',
      );
    }
    if (input.makeDefault && !target.isDefault) {
      await tx
        .update(invoiceThemes)
        .set({ isDefault: false, updatedBy: ctx.userId })
        .where(and(eq(invoiceThemes.isDefault, true), isNull(invoiceThemes.deletedAt)));
    }
    const [updated] = await tx
      .update(invoiceThemes)
      .set({
        name,
        primaryColor: normColor(input.primaryColor),
        secondaryColor: normColor(input.secondaryColor),
        accentColor: normColor(input.accentColor),
        fontFamily: normFont(input.fontFamily),
        headerText: normText(input.headerText, 60),
        footerText: normText(input.footerText, 240),
        tokens: mergeTokens(target.tokens, input),
        ...(input.makeDefault ? { isDefault: true } : {}),
        updatedBy: ctx.userId,
      })
      .where(eq(invoiceThemes.id, id))
      .returning();
    return updated!;
  });
  return toSummary(row);
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

/**
 * Upload a logo image (PNG/JPEG) for a hand-built custom format. react-pdf can
 * only inline PNG/JPEG, so other formats are rejected. The image is stored as a
 * `documents` row (mirrors the logo path in `uploadDocxTheme`) and pointed to by
 * `invoiceThemes.logoDocumentId`. Built-in themes are read-only.
 */
export async function uploadThemeLogo(formData: FormData): Promise<InvoiceThemeSummary> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_invoice_themes');

  const themeId = (formData.get('themeId') as string | null)?.trim();
  if (!themeId) throw new AppError('validation', 'Missing themeId.');
  const file = formData.get('file');
  if (!(file instanceof File)) {
    throw new AppError('validation', 'Missing or invalid image file in upload payload.');
  }
  if (file.size === 0) throw new AppError('validation', 'File is empty.');
  if (file.size > MAX_LOGO_BYTES) {
    throw new AppError(
      'storage.size_exceeded',
      `Logo exceeds ${Math.round(MAX_LOGO_BYTES / 1024 / 1024)} MB limit.`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Sniff the magic bytes — never trust the browser-declared MIME.
  let ext: 'png' | 'jpg';
  let contentType: 'image/png' | 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    ext = 'png';
    contentType = 'image/png';
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    ext = 'jpg';
    contentType = 'image/jpeg';
  } else {
    throw new AppError('storage.mime_mismatch', 'Logo must be a PNG or JPEG image.');
  }

  const [target] = await db
    .select()
    .from(invoiceThemes)
    .where(and(eq(invoiceThemes.id, themeId), isNull(invoiceThemes.deletedAt)))
    .limit(1);
  if (!target) throw new AppError('not_found', `invoice theme ${themeId} not found`);
  if (target.kind === 'builtin') {
    throw new AppError('validation', 'Built-in formats are read-only.');
  }

  const admin = createAdminClient();
  const logoPath = `invoice_themes/${themeId}/logo.${ext}`;
  const { error: upErr } = await admin.storage
    .from(THEME_BUCKET)
    .upload(logoPath, bytes, { contentType, upsert: true });
  if (upErr) {
    throw new AppError('internal', `Failed to upload logo to Storage: ${upErr.message}`);
  }

  const updated = await db.transaction(async (tx) => {
    const [logoRow] = await tx
      .insert(documents)
      .values({
        entityType: 'invoice_theme',
        entityId: themeId,
        bucket: THEME_BUCKET,
        storagePath: logoPath,
        visibility: 'internal',
        category: 'invoice_theme_logo',
        originalFilename: file.name || `logo.${ext}`,
        mimeType: contentType,
        sizeBytes: bytes.byteLength,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: documents.id });

    const [row] = await tx
      .update(invoiceThemes)
      .set({ logoDocumentId: logoRow?.id ?? null, updatedBy: ctx.userId })
      .where(eq(invoiceThemes.id, themeId))
      .returning();
    return row!;
  });

  return toSummary(updated);
}

/** Clear a custom format's logo (it falls back to the default brand mark). */
export async function removeThemeLogo(themeId: string): Promise<InvoiceThemeSummary> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_invoice_themes');
  const [target] = await db
    .select()
    .from(invoiceThemes)
    .where(and(eq(invoiceThemes.id, themeId), isNull(invoiceThemes.deletedAt)))
    .limit(1);
  if (!target) throw new AppError('not_found', `invoice theme ${themeId} not found`);
  if (target.kind === 'builtin') {
    throw new AppError('validation', 'Built-in formats are read-only.');
  }
  const [row] = await db
    .update(invoiceThemes)
    .set({ logoDocumentId: null, updatedBy: ctx.userId })
    .where(eq(invoiceThemes.id, themeId))
    .returning();
  return toSummary(row!);
}
