import type { Metadata } from 'next';

import { ProfileHeader } from '@/components/entity/profile-header';
import { listHolidays, type HolidayRow } from '@/lib/server/entities/holidays';

import { HolidaysClient } from './holidays-client';

export const metadata: Metadata = { title: 'Holidays · Apar Dashboard' };

export default async function HolidaysPage() {
  let initial: readonly HolidayRow[] = [];
  let error: string | null = null;
  try {
    initial = await listHolidays();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Could not load holidays.';
  }

  return (
    <>
      <ProfileHeader
        title="Holidays"
        subtitle="Company holiday calendar. Payroll uses it to compute a month's working days (calendar days − Sundays − holidays) when prorating salary by attendance."
        back={{ href: '/', label: 'Back to dashboard' }}
      />
      <div className="p-4 sm:p-6">
        {error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : (
          <HolidaysClient initial={initial} />
        )}
      </div>
    </>
  );
}
