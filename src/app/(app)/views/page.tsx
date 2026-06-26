import type { Metadata } from 'next';
import { BookmarkIcon } from 'lucide-react';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';

export const metadata: Metadata = {
  title: 'Saved Views · Apar Dashboard',
};

export default function ViewsPage() {
  return (
    <>
      <PageHeader
        title="Saved views"
        description="Personal and shared filter/sort/column presets across every list page."
      />
      <EmptyState
        icon={BookmarkIcon}
        title="Saved views not built yet"
        description="Saved views appear once we ship the DataTable component and the saved_views table (Phase 2.5)."
      />
    </>
  );
}
