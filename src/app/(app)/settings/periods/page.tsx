import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { ProfileHeader } from '@/components/entity/profile-header';
import { db } from '@/lib/db/client';
import { settings } from '@/lib/db/schema/settings';
import { getPeriods } from '@/lib/server-stub/ledger-actions';
import { PeriodsClient } from './periods-client';

export const metadata: Metadata = { title: 'Periods · Apar Dashboard' };

export default async function PeriodsPage() {
  const [periodsList, enforcementRow] = await Promise.all([
    getPeriods(),
    db
      .select({ valueBool: settings.valueBool })
      .from(settings)
      .where(eq(settings.key, 'enforce_period_close'))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);
  const enforceClose = enforcementRow?.valueBool ?? false;

  return (
    <>
      <ProfileHeader
        title="Period management"
        subtitle="Soft-close locks new postings; hard-close requires partner + a reason to reopen. Disabled period-close enforcement is highlighted below as a configuration warning."
        back={{ href: '/', label: 'Back to dashboard' }}
      />
      <PeriodsClient initialPeriods={periodsList} enforceClose={enforceClose} />
    </>
  );
}
