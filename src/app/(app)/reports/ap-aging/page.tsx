import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { getAgingReport } from '@/lib/server-stub/ledger-actions';
import { AgingClient } from '../_aging/aging-client';

export const metadata: Metadata = { title: 'AP aging · Apār Dashboard' };

type Props = { searchParams: Promise<{ asOf?: string }> };

export default async function ApAgingPage({ searchParams }: Props) {
  const sp = await searchParams;
  const asOfDate = sp.asOf ?? new Date().toISOString().slice(0, 10);
  const rows = await getAgingReport({ side: 'payable', asOfDate });
  return (
    <>
      <ProfileHeader
        title="AP aging"
        subtitle="Open payables bucketed by days. Tracks when Apār is overdue on a vendor bill."
        back={{ href: '/reports', label: 'All reports' }}
      />
      <AgingClient side="payable" rows={rows} asOfDate={asOfDate} basePath="/reports/ap-aging" />
    </>
  );
}
