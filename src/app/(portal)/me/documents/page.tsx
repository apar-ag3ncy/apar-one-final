import type { Metadata } from 'next';
import { DocumentList, type EntityDocument } from '@/components/entity/document-list';

export const metadata: Metadata = { title: 'My documents · Apār self-service' };

// TODO(backend): replace with A.getMyDocuments() — restricted to the logged-in
// employee's own documents (offer letter, signed contract, KYC self-uploads).
const DOCS: readonly EntityDocument[] = [
  {
    id: 'd1',
    name: 'Offer letter - Mehta, Anjali.pdf',
    kind: 'offer_letter',
    mimeType: 'application/pdf',
    sizeBytes: 184_321,
    uploadedAt: '2024-04-01',
    signStatus: 'signed',
    signedAt: '2024-03-28',
  },
  {
    id: 'd2',
    name: 'Employment agreement v1.pdf',
    kind: 'contract',
    mimeType: 'application/pdf',
    sizeBytes: 421_998,
    uploadedAt: '2024-04-01',
    signStatus: 'signed',
    signedAt: '2024-04-01',
  },
  {
    id: 'd3',
    name: 'Employment agreement v2 - 2026 update.pdf',
    kind: 'contract',
    mimeType: 'application/pdf',
    sizeBytes: 432_104,
    uploadedAt: '2026-04-15',
    signStatus: 'signed',
    signedAt: '2026-04-12',
    supersedesId: 'd2',
  },
];

export default function MeDocumentsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">My documents</h1>
        <p className="text-muted-foreground text-sm">
          Only documents that belong to you — offer letter, signed contracts, KYC uploads, payslips.
          Confidential to your account.
        </p>
      </header>
      <DocumentList
        documents={DOCS}
        // TODO(backend): wire onDownload to resolveDocumentUrl(documentId) once A ships.
      />
    </div>
  );
}
