import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { getTrialBalance } from '@/lib/server-stub/ledger-actions';
import { TrialBalanceClient } from './trial-balance-client';

export const metadata: Metadata = { title: 'Trial balance · Apār Dashboard' };

type Props = { searchParams: Promise<{ asOf?: string; includeReversed?: string }> };

export default async function TrialBalancePage({ searchParams }: Props) {
  const sp = await searchParams;
  const asOfDate = sp.asOf ?? new Date().toISOString().slice(0, 10);
  const includeReversed = sp.includeReversed === '1';
  const rows = await getTrialBalance({ asOfDate, includeReversed });
  return (
    <>
      <ProfileHeader
        title="Trial balance"
        subtitle="Every GL account with debit + credit totals. Sum of debits must equal sum of credits — if it doesn't, a posting got corrupted and you should stop and call the partner."
        back={{ href: '/reports', label: 'All reports' }}
      />
      <TrialBalanceClient rows={rows} asOfDate={asOfDate} includeReversed={includeReversed} />
    </>
  );
}
