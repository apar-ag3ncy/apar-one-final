import 'server-only';

import { AppError } from './errors';
import { logActivity } from './activity';
import { logAudit } from './audit';
import { requireCapability, type CurrentUserContext } from './rbac';
import { createAdminClient } from './supabase/server';

/**
 * Storage helpers. CLAUDE rules #26 / #27 / #33 + brief Rule 46:
 *
 *   - KYC docs → `restricted-kyc` bucket ONLY
 *   - Every restricted-doc access → `document_access_log` (Phase 3+) AND
 *     `audit_log` + `entity_activity_log`
 *   - Signed URLs only; default TTL 5 min, KYC/bank TTL 60 s
 *
 * Uses the SERVICE ROLE client because (a) signed-URL minting requires
 * elevated permissions in Supabase Storage, (b) audit logging needs to
 * write through RLS, (c) the audit row itself is the evidence the caller
 * had the capability — we check `requireCapability` BEFORE minting.
 */

const KYC_TTL_SECONDS = 60; // CLAUDE rule #33 (the 60s / 1min variant)
const BANK_TTL_SECONDS = 60;
const DOCUMENT_TTL_SECONDS = 300; // 5 min default
const KYC_BUCKET = 'restricted-kyc';
const DOCUMENT_BUCKETS = [
  'public-docs',
  'internal-docs',
  'restricted-docs',
  'restricted-kyc',
] as const;

export type SignedUrl = {
  signedUrl: string;
  expiresAt: string; // ISO timestamp
  ttlSeconds: number;
};

/**
 * Reveal a KYC document. Capability-gated, audit-logged, 60s URL.
 * `objectKey` is the path inside `restricted-kyc`.
 */
export async function revealKyc(
  ctx: CurrentUserContext,
  args: {
    objectKey: string;
    entityType: string;
    entityId: string;
    documentKind: string; // 'kyc_pan' | 'kyc_aadhaar' | ...
  },
): Promise<SignedUrl> {
  requireCapability(ctx, 'reveal_kyc', 'Missing capability to reveal KYC document.');
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(KYC_BUCKET)
    .createSignedUrl(args.objectKey, KYC_TTL_SECONDS, {
      // Inline so the viewer can render PDFs (`Content-Disposition: attachment`
      // can be added at the caller's discretion for explicit downloads).
      download: false,
    });
  if (error || !data?.signedUrl) {
    throw new AppError('kyc.reveal_capability', 'Failed to mint signed URL.', {
      cause: error,
    });
  }
  const expiresAt = new Date(Date.now() + KYC_TTL_SECONDS * 1000).toISOString();

  await logAudit({
    actorId: ctx.userId,
    entityType: args.entityType,
    entityId: args.entityId,
    action: 'reveal_kyc',
    changes: {
      object_key: args.objectKey,
      document_kind: args.documentKind,
      ttl_seconds: KYC_TTL_SECONDS,
    },
  });
  await logActivity({
    entityType: args.entityType,
    entityId: args.entityId,
    actorId: ctx.userId,
    kind: 'kyc.accessed',
    summary: `Accessed KYC document (${args.documentKind})`,
    payload: { document_kind: args.documentKind },
  });

  return { signedUrl: data.signedUrl, expiresAt, ttlSeconds: KYC_TTL_SECONDS };
}

/**
 * Reveal a bank-account number. Same flow as `revealKyc` with a different
 * capability + activity kind.
 */
export async function revealBank(
  ctx: CurrentUserContext,
  args: {
    objectKey: string;
    entityType: string;
    entityId: string;
  },
): Promise<SignedUrl> {
  requireCapability(ctx, 'reveal_bank', 'Missing capability to reveal bank account.');
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(KYC_BUCKET)
    .createSignedUrl(args.objectKey, BANK_TTL_SECONDS, { download: false });
  if (error || !data?.signedUrl) {
    throw new AppError('kyc.reveal_capability', 'Failed to mint signed URL.', {
      cause: error,
    });
  }
  const expiresAt = new Date(Date.now() + BANK_TTL_SECONDS * 1000).toISOString();

  await logAudit({
    actorId: ctx.userId,
    entityType: args.entityType,
    entityId: args.entityId,
    action: 'reveal_bank',
    changes: { object_key: args.objectKey, ttl_seconds: BANK_TTL_SECONDS },
  });
  await logActivity({
    entityType: args.entityType,
    entityId: args.entityId,
    actorId: ctx.userId,
    kind: 'bank.revealed',
    summary: `Accessed bank account details`,
  });

  return { signedUrl: data.signedUrl, expiresAt, ttlSeconds: BANK_TTL_SECONDS };
}

/**
 * Get a signed URL for a regular (non-KYC) document. SPEC-AMENDMENT-001
 * §10.3 — used by `<DocumentViewer>` to render the PDF inline. Caller
 * decides whether the audit + activity row should be written; we
 * default to true.
 */
export async function getSignedDocumentUrl(
  ctx: CurrentUserContext,
  args: {
    bucket: (typeof DOCUMENT_BUCKETS)[number];
    objectKey: string;
    entityType: string;
    entityId: string;
    ttlSeconds?: number;
    asAttachment?: boolean;
    audit?: boolean;
  },
): Promise<SignedUrl> {
  // KYC bucket is only reachable via revealKyc/revealBank — block the
  // generic helper from leaking signed URLs without the capability check.
  if (args.bucket === 'restricted-kyc') {
    throw new AppError(
      'kyc.reveal_capability',
      'Use revealKyc / revealBank for restricted-kyc bucket; generic helper rejected.',
    );
  }
  const admin = createAdminClient();
  const ttl = args.ttlSeconds ?? DOCUMENT_TTL_SECONDS;
  const { data, error } = await admin.storage
    .from(args.bucket)
    .createSignedUrl(args.objectKey, ttl, {
      download: args.asAttachment ?? false,
    });
  if (error || !data?.signedUrl) {
    throw new AppError('internal', 'Failed to mint signed URL.', { cause: error });
  }
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  if (args.audit ?? true) {
    await logAudit({
      actorId: ctx.userId,
      entityType: args.entityType,
      entityId: args.entityId,
      action: 'sign_url',
      changes: { bucket: args.bucket, object_key: args.objectKey, ttl_seconds: ttl },
    });
  }

  return { signedUrl: data.signedUrl, expiresAt, ttlSeconds: ttl };
}

const MIME_MAGIC: Array<{
  mime: string;
  test: (bytes: Uint8Array) => boolean;
}> = [
  // PDF: 25 50 44 46 (`%PDF`)
  {
    mime: 'application/pdf',
    test: (b) => b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
  },
  // PNG: 89 50 4E 47
  {
    mime: 'image/png',
    test: (b) => b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  // JPEG: FF D8 FF
  {
    mime: 'image/jpeg',
    test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  // ZIP / DOCX / XLSX containers: 50 4B 03 04 — caller decides specific type from extension
  {
    mime: 'application/zip',
    test: (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04,
  },
];

/**
 * Magic-byte MIME sniff. SPEC-AMENDMENT-001 §10.3:
 * "Sniffs MIME type from file bytes (not just trust the browser's
 * header); rejects mismatch."
 *
 * Caller passes the first 64+ bytes of the file. Returns the detected
 * MIME or `null` if unknown. Throws `storage.mime_mismatch` (via the
 * caller wrapping the result) if `expected` is set and detected differs.
 */
export function sniffMime(bytes: Uint8Array, expected?: string): string {
  for (const { mime, test } of MIME_MAGIC) {
    if (test(bytes)) {
      if (expected && expected !== mime) {
        // ZIP containers map to many specific docx/xlsx/pptx MIMEs.
        // Accept as-long-as both are zip-family or both are pdf-family.
        if (expected.includes('zip') || expected.includes('officedocument')) {
          if (mime === 'application/zip') return expected;
        }
        throw new AppError(
          'storage.mime_mismatch',
          `MIME mismatch: client claimed "${expected}" but bytes are "${mime}".`,
        );
      }
      return mime;
    }
  }
  if (expected) {
    throw new AppError(
      'storage.mime_mismatch',
      `MIME could not be confirmed from bytes; client claimed "${expected}".`,
    );
  }
  return 'application/octet-stream';
}
