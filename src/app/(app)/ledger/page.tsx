import type { Metadata } from 'next';
import { BookOpenIcon } from 'lucide-react';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';

export const metadata: Metadata = {
  title: 'Ledger · Apār Dashboard',
};

export default function LedgerPage() {
  return (
    <>
      <PageHeader
        title="Ledger"
        description="Confirmed transactions across clients, vendors, employees, and office overheads."
      />
      <EmptyState
        icon={BookOpenIcon}
        title="Ledger module not built yet"
        description="Transactions appear here only after a document extraction is reviewed and confirmed. Lands in Phase 3."
      />
    </>
  );
}
