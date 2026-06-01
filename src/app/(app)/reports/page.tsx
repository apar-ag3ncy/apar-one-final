import type { Metadata } from 'next';
import { BarChart3Icon } from 'lucide-react';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';

export const metadata: Metadata = {
  title: 'Reports · Apār Dashboard',
};

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Reports"
        description="Pre-built reports: AR/AP aging, client P&L, monthly tax summaries, vendor spend, project profitability."
      />
      <EmptyState
        icon={BarChart3Icon}
        title="Reports catalog not built yet"
        description="Each report is a typed file under src/reports/. Catalog and runners are scheduled for Phase 2.5 onward."
      />
    </>
  );
}
