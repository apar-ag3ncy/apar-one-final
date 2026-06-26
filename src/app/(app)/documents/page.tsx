import type { Metadata } from 'next';
import { FileTextIcon } from 'lucide-react';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';

export const metadata: Metadata = {
  title: 'Documents · Apar Dashboard',
};

export default function DocumentsPage() {
  return (
    <>
      <PageHeader
        title="Documents"
        description="Upload financial documents and review their extractions before they post to the ledger."
      />
      <EmptyState
        icon={FileTextIcon}
        title="Documents module not built yet"
        description="Upload + review screen land in Phase 3 (P3.05 / P3.06). Phase 1 covers the storage buckets and access logging."
      />
    </>
  );
}
