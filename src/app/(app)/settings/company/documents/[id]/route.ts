import { getCompanyDocumentBlob } from '@/lib/server/settings/company-data';
import { requireCapability } from '@/lib/rbac';
import { AppError } from '@/lib/errors';
import { getActorContext } from '@/lib/server/actor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Streams a company document for inline viewing (default) or download
 * (`?download=1`). Capability-gated by `manage_company_profile`. The bytes
 * live in Postgres (`company_documents.data`); see company_documents.ts for
 * why inline storage is used instead of the Supabase vault.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await getActorContext();
    requireCapability(ctx, 'manage_company_profile');

    const { id } = await params;
    const doc = await getCompanyDocumentBlob(id);
    if (!doc) {
      return new Response('Document not found', { status: 404 });
    }

    const asDownload = new URL(req.url).searchParams.get('download') === '1';
    // RFC 5987 filename* handles non-ASCII names; the plain filename is the
    // ASCII-safe fallback for older clients.
    const asciiName = doc.originalFilename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const encodedName = encodeURIComponent(doc.originalFilename);
    const disposition = `${asDownload ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;

    const body = new Uint8Array(doc.data);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': doc.mimeType || 'application/octet-stream',
        'Content-Disposition': disposition,
        'Content-Length': String(doc.sizeBytes),
        // Private to the authenticated session; never cache in shared proxies.
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    const status = e instanceof AppError ? e.httpStatus : 500;
    const message = e instanceof AppError ? e.message : 'Failed to load document';
    return new Response(message, { status });
  }
}
