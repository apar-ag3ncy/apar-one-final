import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { getPeriods } from '@/lib/server-stub/ledger-actions';
import { PeriodsClient } from './periods-client';

export const metadata: Metadata = { title: 'Periods · Apār Dashboard' };

export default async function PeriodsPage() {
  const periods = await getPeriods();
  return (
    <>
      <ProfileHeader
        title="Period management"
        subtitle="Soft-close locks new postings; hard-close requires partner + a reason to reopen. Disabled period-close enforcement is highlighted below as a configuration warning."
        back={{ href: '/', label: 'Back to dashboard' }}
      />
      <PeriodsClient initialPeriods={periods} />
    </>
  );
}
